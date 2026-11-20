import type Business from '#models/business'
import BusinessModel from '#models/business'
import BusinessStaff, { type StaffRole } from '#models/business_staff'
import Role from '#models/role'
import User from '#models/user'
import { OrderError } from '#services/order_service'
import PermissionService from '#services/permission_service'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { DateTime } from 'luxon'

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

/**
 * Personal del negocio y equipos del local.
 *
 *  - El dueño vincula cada celular o tablet una sola vez con el código del
 *    negocio. Desde entonces el equipo sabe de qué restaurante es.
 *  - En un equipo vinculado el personal entra SOLO con su PIN (único en el
 *    negocio). El PIN solo funciona desde equipos vinculados: así un PIN de
 *    4 a 6 números no sirve desde cualquier navegador del mundo.
 */
export default class StaffService {
  static validarPin(pin: unknown) {
    const limpio = String(pin ?? '').trim()
    if (!/^\d{4,6}$/.test(limpio)) throw new OrderError('El PIN debe tener de 4 a 6 números')
    return limpio
  }

  static validarRol(rol: unknown): StaffRole {
    return rol === 'cajero' || rol === 'gerente' ? rol : 'mesero'
  }

  static async listar(business: Business) {
    return BusinessStaff.query().where('business_id', business.id).orderBy('name', 'asc')
  }

  private static async pinLibre(business: Business, pin: string, salvoId?: number) {
    const otro = await BusinessStaff.query()
      .where('business_id', business.id)
      .andWhere('pin_lookup', PermissionService.pinLookup(business.id, pin))
      .if(salvoId, (q) => q.whereNot('id', salvoId!))
      .first()
    if (otro) throw new OrderError('Ese PIN ya lo usa otra persona. Elige otro.')
  }

  static async crear(business: Business, datos: { name: string; pin: string; role?: string }) {
    const nombre = String(datos.name ?? '')
      .trim()
      .slice(0, 80)
    if (!nombre) throw new OrderError('Escribe el nombre')
    const pin = this.validarPin(datos.pin)
    await this.pinLibre(business, pin)

    const rol = await Role.findBy('name', 'personal')
    if (!rol) throw new OrderError('Falta el rol "personal": corre las migraciones')

    return db.transaction(async (trx) => {
      const user = await User.create(
        {
          name: nombre,
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
          pinLookup: PermissionService.pinLookup(business.id, pin),
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
    const staff = await BusinessStaff.query()
      .where('business_id', business.id)
      .andWhere('id', id)
      .firstOrFail()
    if (datos.name !== undefined) {
      const nombre = String(datos.name).trim().slice(0, 80)
      if (!nombre) throw new OrderError('Escribe el nombre')
      staff.name = nombre
    }
    if (datos.role !== undefined) staff.role = this.validarRol(datos.role)
    if (datos.pin) {
      const pin = this.validarPin(datos.pin)
      await this.pinLibre(business, pin, staff.id)
      staff.pinHash = await hash.make(pin)
      staff.pinLookup = PermissionService.pinLookup(business.id, pin)
    }
    if (datos.isActive !== undefined) staff.isActive = Boolean(datos.isActive)
    // Cambiar rol o desactivar cierra sus sesiones: los permisos nuevos rigen ya.
    if (datos.isActive === false || datos.role !== undefined) {
      await db.from('auth_access_tokens').where('tokenable_id', staff.userId).delete()
    }
    await staff.save()
    return staff
  }

  static async eliminar(business: Business, id: number) {
    const staff = await BusinessStaff.query()
      .where('business_id', business.id)
      .andWhere('id', id)
      .firstOrFail()
    await User.query().where('id', staff.userId).delete()
  }

  // ------------------------------------------------------------- equipos

  /** Código de vinculación del negocio (se crea la primera vez). */
  static async codigoVinculacion(business: Business, renovar = false) {
    if (!business.posPairingCode || renovar) {
      business.posPairingCode = String(randomInt(0, 1_000_000)).padStart(6, '0')
      await business.save()
    }
    return business.posPairingCode
  }

  /** Un equipo nuevo se vincula escribiendo el código que ve el dueño. */
  static async vincular(codigo: string, nombre: string) {
    const limpio = String(codigo ?? '').replace(/\D/g, '')
    const clave = `vinc:${limpio.slice(0, 2)}`
    PermissionService.frenarFallos(clave)
    const business =
      limpio.length === 6 ? await BusinessModel.findBy('pos_pairing_code', limpio) : null
    if (!business || business.status !== 'activo') {
      PermissionService.registrarFallo(clave)
      throw new OrderError('Código incorrecto. Pídelo al dueño en Infraestructura → Equipos.')
    }
    const token = randomBytes(32).toString('hex')
    const device = await db
      .table('pos_devices')
      .insert({
        business_id: business.id,
        name:
          String(nombre ?? '')
            .trim()
            .slice(0, 60) || 'Equipo',
        token_hash: sha(token),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
    return {
      deviceToken: token,
      deviceId: device[0].id ?? device[0],
      negocio: { uuid: business.uuid, name: business.name },
    }
  }

  static async equipo(deviceToken: string) {
    if (!deviceToken) return null
    const d = await db
      .from('pos_devices')
      .where('token_hash', sha(String(deviceToken)))
      .whereNull('revoked_at')
      .first()
    return d ?? null
  }

  /** Datos públicos del equipo vinculado (para la pantalla de PIN). */
  static async infoEquipo(deviceToken: string) {
    const d = await this.equipo(deviceToken)
    if (!d) return null
    const b = await BusinessModel.find(d.business_id)
    if (!b || b.status !== 'activo') return null
    return {
      equipo: d.name,
      modo: d.mode as 'pdv' | 'monitor',
      negocio: { uuid: b.uuid, name: b.name },
    }
  }

  /** Entrada solo con PIN, desde un equipo vinculado. */
  static async entrar(deviceToken: string, pin: string) {
    const d = await this.equipo(deviceToken)
    if (!d) throw new OrderError('Este equipo ya no está vinculado. Vincúlalo otra vez.')
    if (d.mode === 'monitor') throw new OrderError('Este equipo es un monitor de producción')
    const clave = `pin:${d.business_id}:${d.id}`
    PermissionService.frenarFallos(clave)

    const limpio = String(pin ?? '').trim()
    const staff = /^\d{4,6}$/.test(limpio)
      ? await BusinessStaff.query()
          .where('business_id', d.business_id)
          .andWhere('pin_lookup', PermissionService.pinLookup(d.business_id, limpio))
          .first()
      : null
    if (!staff) {
      PermissionService.registrarFallo(clave)
      throw new OrderError('PIN incorrecto')
    }
    if (!staff.isActive) throw new OrderError('Tu usuario está desactivado')

    await db.from('pos_devices').where('id', d.id).update({ last_seen_at: new Date() })
    const user = await User.findOrFail(staff.userId)
    const token = await User.accessTokens.create(user, ['*'], { expiresIn: '12 hours' })
    await db
      .from('auth_access_tokens')
      .where('id', String(token.identifier))
      .update({ pos_device_id: d.id })
    const b = await BusinessModel.findOrFail(d.business_id)
    return { token, staff, negocio: { uuid: b.uuid, name: b.name } }
  }

  static async equipos(business: Business) {
    const filas = await db
      .from('pos_devices')
      .where('business_id', business.id)
      .whereNull('revoked_at')
      .orderBy('id', 'asc')
      .select('id', 'name', 'mode', 'area_ids', 'cash_register_id', 'last_seen_at', 'created_at')
    return filas.map((d) => ({
      id: d.id,
      name: d.name,
      mode: d.mode,
      areaIds: StaffService.areasDeEquipo(d),
      cashRegisterId: d.cash_register_id,
      lastSeenAt: d.last_seen_at,
      createdAt: d.created_at,
    }))
  }

  static areasDeEquipo(d: { area_ids?: string | null }): number[] {
    try {
      const v = JSON.parse(d.area_ids ?? '[]')
      return Array.isArray(v) ? v.map(Number).filter(Boolean) : []
    } catch {
      return []
    }
  }

  static async editarEquipo(
    business: Business,
    id: number,
    datos: { name?: string; cashRegisterId?: number | null; mode?: string; areaIds?: number[] }
  ) {
    const cambios: Record<string, unknown> = { updated_at: new Date() }
    if (datos.name !== undefined) cambios.name = String(datos.name).trim().slice(0, 60) || 'Equipo'
    if (datos.mode !== undefined) cambios.mode = datos.mode === 'monitor' ? 'monitor' : 'pdv'
    if (datos.areaIds !== undefined) {
      const filas = await db.from('production_areas').where('business_id', business.id).select('id')
      const validas = filas.map((a) => a.id)
      cambios.area_ids = JSON.stringify(
        (datos.areaIds ?? []).map(Number).filter((a) => validas.includes(a))
      )
    }
    if (datos.cashRegisterId !== undefined) {
      const id2 = Number(datos.cashRegisterId) || null
      if (id2) {
        const caja = await db
          .from('cash_registers')
          .where('business_id', business.id)
          .andWhere('id', id2)
          .first()
        if (!caja) throw new OrderError('Caja no válida')
      }
      cambios.cash_register_id = id2
    }
    await db
      .from('pos_devices')
      .where('business_id', business.id)
      .andWhere('id', id)
      .update(cambios)
    // Un equipo que pasa a monitor no debe tener sesiones de personal abiertas.
    if (cambios.mode === 'monitor')
      await db.from('auth_access_tokens').where('pos_device_id', id).delete()
  }

  static async revocarEquipo(business: Business, id: number) {
    await db
      .from('pos_devices')
      .where('business_id', business.id)
      .andWhere('id', id)
      .update({ revoked_at: new Date() })
    await db.from('auth_access_tokens').where('pos_device_id', id).delete()
  }

  /** Para el lado del servidor: equipo del token con el que entró el personal. */
  static async equipoDeToken(tokenId: number | string | bigint) {
    const fila = await db
      .from('auth_access_tokens')
      .where('id', String(tokenId))
      .select('pos_device_id')
      .first()
    if (!fila?.pos_device_id) return null
    return db.from('pos_devices').where('id', fila.pos_device_id).whereNull('revoked_at').first()
  }

  static lockedUntilExpired(until: DateTime | null) {
    return !until || until < DateTime.now()
  }
}
