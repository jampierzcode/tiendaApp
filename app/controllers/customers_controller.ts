import Customer from '#models/customer'
import Order from '#models/order'
import { revisarTelefonoCliente, type CodigoPais } from '#services/countries'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Clientes de la tienda. Se crean solos con el primer pedido, así que aquí
 * solo se consultan y se anotan: nadie los da de alta a mano.
 */
export default class CustomersController {
  public async index({ business, request }: HttpContext) {
    const search = request.input('search')
    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 25))

    const query = Customer.query().where('business_id', business.id)

    if (search) {
      query.where((sub) => {
        sub.whereILike('name', `%${search}%`).orWhereILike('phone', `%${search}%`)
      })
    }

    const clientes = await query.orderBy('id', 'desc').paginate(page, perPage)

    // Cuántos pedidos y cuánto ha gastado cada uno. Se resuelve en una sola
    // consulta agrupada en vez de un preload por cliente.
    const ids = clientes.all().map((c) => c.id)

    const totales = ids.length
      ? await db
          .from('orders')
          .whereIn('customer_id', ids)
          .whereNotIn('status', ['cancelado', 'devuelto'])
          .groupBy('customer_id')
          .select('customer_id')
          .count('* as pedidos')
          .sum('total as gastado')
      : []

    const porCliente = new Map(
      totales.map((t: any) => [
        Number(t.customer_id),
        { pedidos: Number(t.pedidos), gastado: Number(t.gastado) },
      ])
    )

    return {
      status: 'success',
      meta: clientes.getMeta(),
      data: clientes.all().map((c) => ({
        ...c.serialize(),
        pedidos: porCliente.get(c.id)?.pedidos ?? 0,
        gastado: porCliente.get(c.id)?.gastado ?? 0,
      })),
    }
  }

  public async show({ params, business }: HttpContext) {
    const cliente = await Customer.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .preload('orders', (o) => o.preload('items').orderBy('id', 'desc'))
      .firstOrFail()

    return { status: 'success', data: cliente }
  }

  public async update({ params, request, business, response }: HttpContext) {
    const cliente = await Customer.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    const datos = request.only(['name', 'phone', 'email', 'document', 'address', 'city', 'notes'])

    if (datos.name !== undefined && String(datos.name).trim().length < 2) {
      return response.unprocessableEntity({ status: 'error', message: 'Escribe el nombre del cliente' })
    }

    if (datos.email !== undefined) {
      const correo = String(datos.email ?? '').trim().toLowerCase()
      if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) {
        return response.unprocessableEntity({ status: 'error', message: 'El correo no parece válido' })
      }
      datos.email = correo || null
    }

    let telefonoNuevo: string | null = null
    if (datos.phone !== undefined) {
      const digitos = String(datos.phone ?? '').replace(/\D/g, '')
      const problema = revisarTelefonoCliente((business.country as CodigoPais) ?? 'PE', digitos)
      if (problema) return response.unprocessableEntity({ status: 'error', message: problema })

      if (digitos !== cliente.phone) {
        const repetido = await Customer.query()
          .where('business_id', business.id)
          .andWhere('phone', digitos)
          .whereNot('id', cliente.id)
          .first()
        if (repetido) {
          return response.unprocessableEntity({
            status: 'error',
            message: `Ese número ya es de otro cliente (${repetido.name})`,
          })
        }
        telefonoNuevo = digitos
      }
      datos.phone = digitos
    }

    cliente.merge(datos)
    await cliente.save()

    // Los pedidos de este cliente llevan una copia del contacto: se corrige también
    // ahí, para que el chat y los avisos de cada pedido usen el número bueno.
    const copia: Record<string, string | null> = {}
    if (telefonoNuevo) copia.customer_phone = telefonoNuevo
    if (datos.email !== undefined) copia.customer_email = datos.email
    if (Object.keys(copia).length) {
      await Order.query().where('business_id', business.id).where('customer_id', cliente.id).update(copia)
    }

    return { status: 'success', message: 'Cliente actualizado', data: cliente }
  }
}
