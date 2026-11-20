import type Business from '#models/business'
import BusinessStaff from '#models/business_staff'
import { OrderError } from '#services/order_service'
import PosSettingsService, {
  PERMISOS,
  PERMISOS_DUENO,
  type MapaPermisos,
  type Permiso,
  type RolPos,
} from '#services/pos_settings_service'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { createHmac } from 'node:crypto'

/** Quién hace la operación: el dueño (panel) o alguien del personal. */
export interface Actor {
  userId: number
  name: string
  role: 'dueno' | RolPos
  permisos: MapaPermisos
  /** Equipo vinculado desde el que entró (personal). */
  deviceId?: number | null
  /** Caja asignada a ese equipo, si tiene. */
  cashRegisterId?: number | null
}

/**
 * Falta un permiso. El front lo muestra como "Pide autorización": un
 * superior escribe su PIN y la acción se reintenta con él.
 */
export class AutorizacionRequerida extends OrderError {
  constructor(
    public permiso: Permiso,
    mensaje: string
  ) {
    super(mensaje)
  }
}

// Intentos fallidos de PIN por negocio (en memoria: suficiente para una sola instancia).
const fallos = new Map<string, { n: number; hasta: number }>()

export default class PermissionService {
  /** HMAC del PIN, para buscar por PIN sin guardarlo en claro. */
  static pinLookup(businessId: number, pin: string) {
    return createHmac('sha256', String(env.get('APP_KEY')))
      .update(`${businessId}:${String(pin).trim()}`)
      .digest('hex')
  }

  static frenarFallos(clave: string) {
    const f = fallos.get(clave)
    if (f && f.hasta > Date.now() && f.n >= 8) {
      throw new OrderError('Demasiados PIN incorrectos. Espera unos minutos.')
    }
  }

  static registrarFallo(clave: string) {
    const f = fallos.get(clave)
    const vigente = f && f.hasta > Date.now()
    fallos.set(clave, { n: (vigente ? f!.n : 0) + 1, hasta: Date.now() + 5 * 60_000 })
  }

  static async permisosDeRol(business: Business, rol: 'dueno' | RolPos): Promise<MapaPermisos> {
    if (rol === 'dueno') return PERMISOS_DUENO
    const ajustes = await PosSettingsService.leer(business)
    return ajustes.permisos[rol]
  }

  static tiene(actor: Actor, permiso: Permiso, valor?: number | string) {
    const v = actor.permisos[permiso]
    if (PERMISOS[permiso].tipo === 'tope') return Number(v ?? 0) >= Number(valor ?? 0)
    if (PERMISOS[permiso].tipo === 'alcance') return valor === undefined ? true : v === valor
    return v === true
  }

  /**
   * Exige un permiso. Si el actor no lo tiene y llegó el PIN de un superior
   * que sí lo tiene (o que puede autorizar a otros), pasa y queda registrado.
   * Devuelve el nombre de quien autorizó, o null si no hizo falta.
   */
  static async exigir(
    business: Business,
    actor: Actor,
    permiso: Permiso,
    opciones: { pin?: string | null; valor?: number; contexto?: string } = {}
  ): Promise<string | null> {
    if (this.tiene(actor, permiso, opciones.valor)) return null

    const etiqueta = PERMISOS[permiso].label
    const pin = String(opciones.pin ?? '').trim()
    if (!pin) {
      throw new AutorizacionRequerida(
        permiso,
        PERMISOS[permiso].tipo === 'tope'
          ? `Tu descuento máximo es ${actor.permisos[permiso]}%: pide autorización`
          : `Necesitas autorización: ${etiqueta}`
      )
    }

    const clave = `aut:${business.id}`
    this.frenarFallos(clave)
    const aprobador = await BusinessStaff.query()
      .where('business_id', business.id)
      .andWhere('pin_lookup', this.pinLookup(business.id, pin))
      .andWhere('is_active', true)
      .first()
    if (!aprobador) {
      this.registrarFallo(clave)
      throw new AutorizacionRequerida(permiso, 'PIN de autorización incorrecto')
    }
    if (aprobador.userId === actor.userId) {
      throw new AutorizacionRequerida(permiso, 'La autorización tiene que ser de otra persona')
    }

    const permisosAprobador = await this.permisosDeRol(business, aprobador.role as RolPos)
    const lo = { ...actor, permisos: permisosAprobador }
    // "Autorizar a otros" sirve de llave maestra salvo en un tope: ahí manda el tope del que autoriza.
    const puede =
      this.tiene(lo, permiso, opciones.valor) ||
      (PERMISOS[permiso].tipo !== 'tope' && permisosAprobador['autorizar.otros'] === true)
    if (!puede) {
      throw new AutorizacionRequerida(permiso, `${aprobador.name} tampoco puede autorizar esto`)
    }

    await db.table('authorization_logs').insert({
      business_id: business.id,
      permission: permiso,
      requested_by_user_id: actor.userId,
      requested_by_name: actor.name,
      authorized_by_user_id: aprobador.userId,
      authorized_by_name: aprobador.name,
      context: opciones.contexto?.slice(0, 255) ?? null,
      created_at: new Date(),
    })
    return aprobador.name
  }
}
