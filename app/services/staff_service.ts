import type Business from '#models/business'
import BusinessStaff, { type StaffRole } from '#models/business_staff'
import Role from '#models/role'
import User from '#models/user'
import { OrderError } from '#services/order_service'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'

const MAX_INTENTOS = 5
const BLOQUEO_MIN = 5

/**
 * Personal del negocio. La mesera no tiene correo: el dueño le pone nombre y
 * PIN, y ella entra eligiendo su nombre en el link del comandero. Por debajo
 * existe un `users` (rol "personal") solo para emitir el token.
 */
export default class StaffService {
  static validarPin(pin: unknown) {
    const limpio = String(pin ?? '').trim()
    if (!/^\d{4,6}$/.test(limpio)) throw new OrderError('El PIN debe tener de 4 a 6 números')
    return limpio
  }

  static validarRol(rol: unknown): StaffRole {
    return rol === 'cajero' ? 'cajero' : 'mesero'
  }

  static async listar(business: Business) {
    return BusinessStaff.query().where('business_id', business.id).orderBy('name', 'asc')
  }

  static async crear(business: Business, datos: { name: string; pin: string; role?: string }) {
    const nombre = String(datos.name ?? '').trim().slice(0, 80)
    if (!nombre) throw new OrderError('Escribe el nombre')
    const pin = this.validarPin(datos.pin)

    const rol = await Role.findBy('name', 'personal')
    if (!rol) throw new OrderError('Falta el rol "personal": corre las migraciones')

    return db.transaction(async (trx) => {
      const user = await User.create(
        {
          name: nombre,
          // Correo interno, nunca se muestra ni sirve para entrar con contraseña.
          email: `personal-${randomBytes(8).toString('hex')}@personal.peaky.local`,
          password: randomBytes(24).toString('hex'),
          rolId: rol.id,
          status: 'activo',
        },
        { client: trx }
      )
      return BusinessStaff.create(
        {
          businessId: business.id,
          userId: user.id,
          name: nombre,
          role: this.validarRol(datos.role),
          pinHash: await hash.make(pin),
          isActive: true,
          failedAttempts: 0,
        },
        { client: trx }
      )
    })
  }

  static async actualizar(
    business: Business,
    id: number,
    datos: { name?: string; pin?: string; role?: string; isActive?: boolean }
  ) {
    const staff = await BusinessStaff.query().where('business_id', business.id).andWhere('id', id).firstOrFail()
    if (datos.name !== undefined) {
      const nombre = String(datos.name).trim().slice(0, 80)
      if (!nombre) throw new OrderError('Escribe el nombre')
      staff.name = nombre
    }
    if (datos.role !== undefined) staff.role = this.validarRol(datos.role)
    if (datos.pin) {
      staff.pinHash = await hash.make(this.validarPin(datos.pin))
      staff.failedAttempts = 0
      staff.lockedUntil = null
    }
    if (datos.isActive !== undefined) {
      staff.isActive = Boolean(datos.isActive)
      // Desactivar cierra sus sesiones abiertas en el acto.
      if (!staff.isActive) await db.from('auth_access_tokens').where('tokenable_id', staff.userId).delete()
    }
    await staff.save()
    return staff
  }

  static async eliminar(business: Business, id: number) {
    const staff = await BusinessStaff.query().where('business_id', business.id).andWhere('id', id).firstOrFail()
    // Se borra el usuario: sus comandas quedan con su nombre copiado en la ronda.
    await User.query().where('id', staff.userId).delete()
  }

  /** Entrada con PIN. Tras 5 fallos seguidos el usuario se bloquea 5 minutos. */
  static async entrar(businessUuid: string, staffId: number, pin: string) {
    const fila = await db
      .from('business_staff as s')
      .join('businesses as b', 'b.id', 's.business_id')
      .where('b.uuid', businessUuid)
      .andWhere('s.id', staffId)
      .select('s.id')
      .first()
    if (!fila) throw new OrderError('Usuario no encontrado')

    const staff = await BusinessStaff.findOrFail(fila.id)
    if (!staff.isActive) throw new OrderError('Este usuario está desactivado')

    if (staff.lockedUntil && staff.lockedUntil > DateTime.now()) {
      const min = Math.ceil(staff.lockedUntil.diffNow('minutes').minutes)
      throw new OrderError(`Demasiados intentos. Prueba en ${min} min.`)
    }

    const ok = await hash.verify(staff.pinHash, String(pin ?? '').trim())
    if (!ok) {
      staff.failedAttempts += 1
      if (staff.failedAttempts >= MAX_INTENTOS) {
        staff.failedAttempts = 0
        staff.lockedUntil = DateTime.now().plus({ minutes: BLOQUEO_MIN })
      }
      await staff.save()
      throw new OrderError('PIN incorrecto')
    }

    staff.failedAttempts = 0
    staff.lockedUntil = null
    await staff.save()

    const user = await User.findOrFail(staff.userId)
    const token = await User.accessTokens.create(user, ['*'], { expiresIn: '30 days' })
    return { token, staff }
  }

  /** Nombres para la pantalla de entrada del comandero. */
  static async publicos(businessUuid: string) {
    const business = await db.from('businesses').where('uuid', businessUuid).select('id', 'name', 'status').first()
    if (!business || business.status !== 'activo') return null
    const staff = await db
      .from('business_staff')
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .orderBy('name', 'asc')
      .select('id', 'name', 'role')
    return { negocio: business.name, personal: staff }
  }
}
