import Business from '#models/business'
import Customer from '#models/customer'
import Order from '#models/order'
import Role from '#models/role'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Cuentas de cliente (rol `cliente`).
 *
 * La cuenta es global: una persona con una sola cuenta ve sus pedidos de todas
 * las tiendas. Cada tienda conserva su propia ficha de contacto (`customers`)
 * y la cuenta solo se liga a ellas. Para ligar un pedido hace falta el
 * `claimToken` que recibió quien lo creó, así nadie reclama pedidos ajenos
 * adivinando códigos.
 */
const perfilDe = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  deliveryAddress: u.deliveryAddress,
  deliveryCity: u.deliveryCity,
  latitude: u.latitude === null ? null : Number(u.latitude),
  longitude: u.longitude === null ? null : Number(u.longitude),
})

export default class CustomerAccountsController {
  private async rolCliente() {
    return Role.firstOrCreate({ name: 'cliente' }, { name: 'cliente' })
  }

  /** Liga el contacto del pedido a la cuenta; devuelve false si el código no cuadra. */
  private async reclamar(user: User, slug: string, code: string, claimToken: string) {
    if (!code || !claimToken) return false
    const negocio = await Business.findBy('slug', slug)
    if (!negocio) return false

    const pedido = await Order.query()
      .where('business_id', negocio.id)
      .where('code', code)
      .where('claim_token', claimToken)
      .first()
    if (!pedido?.customerId) return false

    const cliente = await Customer.find(pedido.customerId)
    if (!cliente) return false
    // Un contacto ya ligado a otra cuenta no se roba.
    if (cliente.userId && cliente.userId !== user.id) return false

    cliente.userId = user.id
    await cliente.save()
    return true
  }

  /**
   * Liga el contacto de un pedido anterior demostrando que es suyo con el
   * código del pedido y el teléfono que se usó (coinciden los últimos 9 dígitos).
   * Con el contacto ligado, todo su historial en esa tienda pasa a la cuenta.
   */
  private async reclamarPorTelefono(user: User, slug: string, code: string, phone: string) {
    const digitos = String(phone ?? '').replace(/\D/g, '')
    if (!code || digitos.length < 8) return false
    const negocio = await Business.findBy('slug', slug)
    if (!negocio) return false

    const pedido = await Order.query()
      .where('business_id', negocio.id)
      .where('code', String(code).trim().toUpperCase())
      .first()
    const guardado = (pedido?.customerPhone ?? '').replace(/\D/g, '')
    if (!pedido?.customerId || guardado.slice(-9) !== digitos.slice(-9)) return false

    const cliente = await Customer.find(pedido.customerId)
    if (!cliente || (cliente.userId && cliente.userId !== user.id)) return false
    cliente.userId = user.id
    await cliente.save()
    return true
  }

  public async register({ request, response, params }: HttpContext) {
    const { name, email, password, orderCode, claimToken } = request.only([
      'name',
      'email',
      'password',
      'orderCode',
      'claimToken',
    ])
    const correo = String(email ?? '').trim().toLowerCase()

    if (String(name ?? '').trim().length < 2) {
      return response.unprocessableEntity({ status: 'error', message: 'Escribe tu nombre' })
    }
    if (!EMAIL.test(correo)) {
      return response.unprocessableEntity({ status: 'error', message: 'Escribe un correo válido' })
    }
    if (String(password ?? '').length < 8) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'La contraseña debe tener al menos 8 caracteres',
      })
    }
    if (await User.findBy('email', correo)) {
      return response.conflict({
        status: 'error',
        message: 'Ya existe una cuenta con ese correo. Inicia sesión.',
      })
    }

    const rol = await this.rolCliente()
    const user = await User.create({
      name: String(name).trim(),
      email: correo,
      password: String(password),
      rolId: rol.id,
      status: 'activo',
    })

    const ligado = await this.reclamar(user, params.slug, orderCode, claimToken)
    const token = await User.accessTokens.create(user, ['*'], { expiresIn: '90 days' })

    return response.created({
      status: 'success',
      message: 'Cuenta creada',
      data: { token: token.value!.release(), user: perfilDe(user), ligado },
    })
  }

  public async login({ request, response }: HttpContext) {
    const { email, password, slug, orderCode, claimToken } = request.only([
      'email',
      'password',
      'slug',
      'orderCode',
      'claimToken',
    ])
    let user: User
    try {
      user = await User.verifyCredentials(String(email ?? '').trim().toLowerCase(), String(password ?? ''))
    } catch {
      return response.unauthorized({ status: 'error', message: 'Correo o contraseña incorrectos' })
    }
    await user.load('role')
    if (user.role?.name !== 'cliente') {
      return response.forbidden({
        status: 'error',
        message: 'Esta cuenta es de un negocio. Entra por el panel de tu tienda.',
      })
    }
    if (user.status !== 'activo') {
      return response.forbidden({ status: 'error', message: 'Tu cuenta está inactiva.' })
    }

    if (slug && orderCode && claimToken) await this.reclamar(user, slug, orderCode, claimToken)
    const token = await User.accessTokens.create(user, ['*'], { expiresIn: '90 days' })

    return {
      status: 'success',
      data: { token: token.value!.release(), user: perfilDe(user) },
    }
  }

  public async me({ auth, response }: HttpContext) {
    const user = auth.user!
    await user.load('role')
    if (user.role?.name !== 'cliente') {
      return response.forbidden({ status: 'error', message: 'No es una cuenta de cliente' })
    }
    return { status: 'success', data: perfilDe(user) }
  }

  /** Guarda nombre, WhatsApp y la dirección/ubicación para pedir. */
  public async updateProfile({ auth, request, response }: HttpContext) {
    const user = auth.user!
    await user.load('role')
    if (user.role?.name !== 'cliente') {
      return response.forbidden({ status: 'error', message: 'No es una cuenta de cliente' })
    }

    const d = request.only(['name', 'phone', 'deliveryAddress', 'deliveryCity', 'latitude', 'longitude'])

    if (d.name !== undefined) {
      const nombre = String(d.name).trim()
      if (nombre.length < 2) {
        return response.unprocessableEntity({ status: 'error', message: 'Escribe tu nombre' })
      }
      user.name = nombre
    }
    if (d.phone !== undefined) {
      const digitos = String(d.phone ?? '').replace(/\D/g, '')
      if (digitos && (digitos.length < 8 || digitos.length > 15)) {
        return response.unprocessableEntity({ status: 'error', message: 'El WhatsApp no es válido' })
      }
      user.phone = digitos || null
    }
    if (d.deliveryAddress !== undefined) user.deliveryAddress = String(d.deliveryAddress ?? '').trim().slice(0, 255) || null
    if (d.deliveryCity !== undefined) user.deliveryCity = String(d.deliveryCity ?? '').trim().slice(0, 80) || null

    if (d.latitude !== undefined || d.longitude !== undefined) {
      const vacio = (v: unknown) => v === null || v === '' || v === undefined
      if (vacio(d.latitude) && vacio(d.longitude)) {
        user.latitude = null
        user.longitude = null
      } else {
        const lat = Number(d.latitude)
        const lng = Number(d.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return response.unprocessableEntity({ status: 'error', message: 'La ubicación no es válida' })
        }
        user.latitude = lat
        user.longitude = lng
      }
    }

    await user.save()
    return { status: 'success', message: 'Perfil guardado', data: perfilDe(user) }
  }

  /** Liga un pedido recién hecho a la cuenta con sesión iniciada. */
  public async link({ auth, request, response }: HttpContext) {
    const { slug, orderCode, claimToken, phone } = request.only(['slug', 'orderCode', 'claimToken', 'phone'])
    const ok = claimToken
      ? await this.reclamar(auth.user!, slug, orderCode, claimToken)
      : await this.reclamarPorTelefono(auth.user!, slug, orderCode, phone)
    if (!ok) {
      return response.unprocessableEntity({ status: 'error', message: 'No encontramos un pedido con ese código y ese teléfono. Revisa los datos.' })
    }
    return { status: 'success' }
  }

  /** Pedidos de la cuenta en todas las tiendas, del más reciente al más antiguo. */
  public async orders({ auth }: HttpContext) {
    const filas = await db
      .from('orders')
      .join('customers', 'customers.id', 'orders.customer_id')
      .join('businesses', 'businesses.id', 'orders.business_id')
      .where('customers.user_id', auth.user!.id)
      .orderBy('orders.id', 'desc')
      .limit(100)
      .select(
        'orders.id',
        'orders.code',
        'orders.status',
        'orders.total',
        'orders.created_at',
        'businesses.name as store_name',
        'businesses.slug as store_slug',
        'businesses.logo_url as store_logo',
        'businesses.currency_symbol as currency_symbol',
        db.raw(
          "(select m.body from order_messages m where m.order_id = orders.id order by m.id desc limit 1) as last_message"
        ),
        db.raw(
          "(select m.direction from order_messages m where m.order_id = orders.id order by m.id desc limit 1) as last_direction"
        ),
        db.raw(
          "(select count(*) from order_messages m where m.order_id = orders.id and m.direction = 'out' and m.read_at is null) as unread_messages"
        )
      )

    return {
      status: 'success',
      data: filas.map((f: any) => ({
        id: f.id,
        code: f.code,
        status: f.status,
        total: Number(f.total),
        createdAt: f.created_at,
        storeName: f.store_name,
        storeSlug: f.store_slug,
        storeLogo: f.store_logo,
        currencySymbol: f.currency_symbol,
        unreadMessages: Number(f.unread_messages ?? 0),
        lastMessage: f.last_message ?? null,
        lastDirection: f.last_direction ?? null,
      })),
    }
  }
}
