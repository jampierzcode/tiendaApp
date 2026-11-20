import type Business from '#models/business'
import db from '@adonisjs/lucid/services/db'

export type RolPos = 'mesero' | 'cajero' | 'gerente'
export const ROLES_POS: RolPos[] = ['mesero', 'cajero', 'gerente']

/**
 * Catálogo de permisos del PDV. Pocos y claros a propósito: cada uno es una
 * decisión que el dueño entiende sin manual.
 *   tipo 'si_no'  → true/false
 *   tipo 'tope'   → número (descuento máximo en %)
 *   tipo 'alcance'→ uno de `opciones`
 */
export const PERMISOS = {
  'cuentas.ver': {
    grupo: 'Cuentas',
    label: 'Qué cuentas ve',
    tipo: 'alcance',
    opciones: { propias: 'Solo las que él abrió', todas: 'Todas' },
  },
  'cuentas.abrir_sin_mesa': { grupo: 'Cuentas', label: 'Abrir cuentas para llevar y delivery', tipo: 'si_no' },
  'cuentas.imprimir': { grupo: 'Cuentas', label: 'Imprimir la cuenta (asigna folio)', tipo: 'si_no' },
  'cuentas.reabrir': { grupo: 'Cuentas', label: 'Reabrir una cuenta impresa para agregar', tipo: 'si_no' },
  'cuentas.mover_mesa': { grupo: 'Cuentas', label: 'Cambiar de mesa', tipo: 'si_no' },
  'cuentas.liberar_mesa': { grupo: 'Cuentas', label: 'Liberar mesas', tipo: 'si_no' },
  'cuentas.reimprimir_comanda': { grupo: 'Cuentas', label: 'Reimprimir comandas', tipo: 'si_no' },
  'cuentas.anular_plato': { grupo: 'Cuentas', label: 'Anular platos ya enviados a cocina', tipo: 'si_no' },
  'cuentas.cancelar': { grupo: 'Cuentas', label: 'Cancelar una cuenta completa', tipo: 'si_no' },
  'cobro.cobrar': { grupo: 'Cobro', label: 'Cobrar cuentas', tipo: 'si_no' },
  'cobro.descuento': { grupo: 'Cobro', label: 'Descuento máximo que puede dar (%)', tipo: 'tope' },
  'cobro.cortesia': { grupo: 'Cobro', label: 'Dar cortesías (plato gratis)', tipo: 'si_no' },
  'caja.operar': { grupo: 'Caja', label: 'Abrir caja, ingresos/retiros y corte Z de su caja', tipo: 'si_no' },
  'caja.corte_x': { grupo: 'Caja', label: 'Sacar corte X', tipo: 'si_no' },
  'caja.cerrar_otras': { grupo: 'Caja', label: 'Cerrar cajas de otros y recibir lo de los meseros', tipo: 'si_no' },
  'caja.ver_esperado': {
    grupo: 'Caja',
    label: 'Qué ve de los montos de caja',
    tipo: 'alcance',
    opciones: { todo: 'Todo (esperado y diferencias)', ciego: 'Solo lo que él contó', nada: 'Nada' },
  },
  'caja.corte_global': { grupo: 'Caja', label: 'Hacer el corte global del turno', tipo: 'si_no' },
  'autorizar.otros': { grupo: 'Supervisión', label: 'Autorizar con su PIN lo que otros no pueden', tipo: 'si_no' },
} as const

export type Permiso = keyof typeof PERMISOS
export type ValorPermiso = boolean | number | string
export type MapaPermisos = Record<Permiso, ValorPermiso>

const MESERO: MapaPermisos = {
  'cuentas.ver': 'propias',
  'cuentas.abrir_sin_mesa': true,
  'cuentas.imprimir': true,
  'cuentas.reabrir': false,
  'cuentas.mover_mesa': false,
  'cuentas.liberar_mesa': true,
  'cuentas.reimprimir_comanda': true,
  'cuentas.anular_plato': false,
  'cuentas.cancelar': false,
  'cobro.cobrar': false,
  'cobro.descuento': 0,
  'cobro.cortesia': false,
  'caja.operar': false,
  'caja.corte_x': false,
  'caja.cerrar_otras': false,
  'caja.ver_esperado': 'nada',
  'caja.corte_global': false,
  'autorizar.otros': false,
}

export const PERMISOS_POR_DEFECTO: Record<RolPos, MapaPermisos> = {
  mesero: MESERO,
  cajero: {
    ...MESERO,
    'cuentas.ver': 'todas',
    'cuentas.reabrir': true,
    'cuentas.mover_mesa': true,
    'cobro.cobrar': true,
    'caja.operar': true,
    'caja.cerrar_otras': true,
    'caja.ver_esperado': 'ciego',
  },
  gerente: {
    'cuentas.ver': 'todas',
    'cuentas.abrir_sin_mesa': true,
    'cuentas.imprimir': true,
    'cuentas.reabrir': true,
    'cuentas.mover_mesa': true,
    'cuentas.liberar_mesa': true,
    'cuentas.reimprimir_comanda': true,
    'cuentas.anular_plato': true,
    'cuentas.cancelar': true,
    'cobro.cobrar': true,
    'cobro.descuento': 100,
    'cobro.cortesia': true,
    'caja.operar': true,
    'caja.corte_x': true,
    'caja.cerrar_otras': true,
    'caja.ver_esperado': 'todo',
    'caja.corte_global': true,
    'autorizar.otros': true,
  },
}

/** El dueño (sesión del panel) puede todo. */
export const PERMISOS_DUENO: MapaPermisos = { ...PERMISOS_POR_DEFECTO.gerente }

export interface EstiloSeccion {
  /** 1 normal, 2 doble alto, 3 doble alto y ancho */
  tamano?: 1 | 2 | 3
  negrita?: boolean
}

export interface EstiloTicket {
  copias: number
  titulo: EstiloSeccion
  detalle: EstiloSeccion
  total: EstiloSeccion
  campos: Record<string, boolean>
  pie?: string
}

export interface AjustesPos {
  permisos: Record<RolPos, MapaPermisos>
  /** Segundos sin tocar la pantalla antes de pedir PIN otra vez (0 = nunca). */
  inactividadSegundos: number
  /** true: al cobrar la mesa queda "por liberar" hasta que alguien la libere. */
  liberarMesaManual: boolean
  servicios: { comedor: boolean; para_llevar: boolean; delivery: boolean }
  ticket: {
    nombre?: string
    ruc?: string
    direccion?: string
    telefono?: string
    encabezado?: string
    pie?: string
    leyenda?: string
    tipos: Record<'comanda' | 'cuenta' | 'nota_venta' | 'cancelacion' | 'corte', EstiloTicket>
  }
}

const estilo = (e: Partial<EstiloTicket> = {}): EstiloTicket => ({
  copias: 1,
  titulo: { tamano: 2, negrita: true },
  detalle: { tamano: 1, negrita: false },
  total: { tamano: 2, negrita: true },
  campos: {},
  ...e,
})

export const AJUSTES_POR_DEFECTO: AjustesPos = {
  permisos: PERMISOS_POR_DEFECTO,
  inactividadSegundos: 300,
  liberarMesaManual: false,
  servicios: { comedor: true, para_llevar: true, delivery: true },
  ticket: {
    leyenda: 'Documento no válido como comprobante de pago',
    pie: 'Gracias por su visita',
    tipos: {
      comanda: estilo({
        titulo: { tamano: 3, negrita: true },
        detalle: { tamano: 2, negrita: true },
        campos: { mesero: true, hora: true, ronda: true, servicio: true, cuenta: true },
      }),
      cuenta: estilo({ campos: { direccion: true, telefono: true, ruc: true, mesero: true, folio: true, hora: true, comensales: true, leyenda: true } }),
      nota_venta: estilo({ campos: { direccion: true, telefono: true, ruc: true, mesero: true, folio: true, hora: true, pagos: true, vuelto: true, cajero: true } }),
      cancelacion: estilo({ campos: { motivo: true, firma: true } }),
      corte: estilo({ titulo: { tamano: 2, negrita: true }, campos: { firma: true, top: true } }),
    },
  },
}

/** Mezcla profunda simple: lo guardado gana, lo que falta viene del defecto. */
function mezclar<T>(base: T, guardado: any): T {
  if (guardado === null || guardado === undefined) return base
  if (typeof base !== 'object' || Array.isArray(base)) return guardado as T
  const out: any = { ...base }
  for (const k of Object.keys(guardado)) out[k] = k in (base as any) ? mezclar((base as any)[k], guardado[k]) : guardado[k]
  return out
}

/**
 * Ajustes del PDV por negocio, guardados como JSON en `businesses.pos_settings`.
 */
export default class PosSettingsService {
  static async leer(business: Business | number): Promise<AjustesPos> {
    const id = typeof business === 'number' ? business : business.id
    const fila = await db.from('businesses').where('id', id).select('pos_settings').first()
    let guardado: any = null
    try {
      guardado = fila?.pos_settings ? JSON.parse(fila.pos_settings) : null
    } catch {
      guardado = null
    }
    return mezclar(AJUSTES_POR_DEFECTO, guardado)
  }

  static async guardar(business: Business, cambios: Partial<AjustesPos>) {
    const actual = await this.leer(business)
    const nuevo = mezclar(actual, this.limpiar(cambios))
    await db.from('businesses').where('id', business.id).update({ pos_settings: JSON.stringify(nuevo) })
    return nuevo
  }

  /** Valida lo que llega del panel: solo claves conocidas y valores del tipo correcto. */
  private static limpiar(c: any): Partial<AjustesPos> {
    const out: any = {}
    if (c?.permisos && typeof c.permisos === 'object') {
      out.permisos = {}
      for (const rol of ROLES_POS) {
        if (!c.permisos[rol]) continue
        out.permisos[rol] = {}
        for (const [k, def] of Object.entries(PERMISOS) as [Permiso, any][]) {
          const v = c.permisos[rol][k]
          if (v === undefined) continue
          if (def.tipo === 'si_no') out.permisos[rol][k] = Boolean(v)
          else if (def.tipo === 'tope') out.permisos[rol][k] = Math.min(100, Math.max(0, Number(v) || 0))
          else if (def.tipo === 'alcance' && v in def.opciones) out.permisos[rol][k] = v
        }
      }
    }
    if (c?.inactividadSegundos !== undefined) {
      out.inactividadSegundos = Math.min(7200, Math.max(0, Math.floor(Number(c.inactividadSegundos) || 0)))
    }
    if (c?.liberarMesaManual !== undefined) out.liberarMesaManual = Boolean(c.liberarMesaManual)
    if (c?.servicios) {
      out.servicios = {}
      for (const s of ['comedor', 'para_llevar', 'delivery']) {
        if (c.servicios[s] !== undefined) out.servicios[s] = Boolean(c.servicios[s])
      }
    }
    if (c?.ticket && typeof c.ticket === 'object') {
      const t: any = {}
      for (const k of ['nombre', 'ruc', 'direccion', 'telefono', 'encabezado', 'pie', 'leyenda']) {
        if (c.ticket[k] !== undefined) t[k] = String(c.ticket[k] ?? '').slice(0, 200)
      }
      if (c.ticket.tipos && typeof c.ticket.tipos === 'object') {
        t.tipos = {}
        for (const tipo of ['comanda', 'cuenta', 'nota_venta', 'cancelacion', 'corte']) {
          const e = c.ticket.tipos[tipo]
          if (!e) continue
          const sec = (x: any) =>
            x ? { tamano: [1, 2, 3].includes(Number(x.tamano)) ? Number(x.tamano) : 1, negrita: Boolean(x.negrita) } : undefined
          t.tipos[tipo] = {
            ...(e.copias !== undefined ? { copias: Math.min(5, Math.max(1, Math.floor(Number(e.copias) || 1))) } : {}),
            ...(e.titulo ? { titulo: sec(e.titulo) } : {}),
            ...(e.detalle ? { detalle: sec(e.detalle) } : {}),
            ...(e.total ? { total: sec(e.total) } : {}),
            ...(e.campos && typeof e.campos === 'object'
              ? { campos: Object.fromEntries(Object.entries(e.campos).map(([k, v]) => [k.slice(0, 30), Boolean(v)])) }
              : {}),
          }
        }
      }
      out.ticket = t
    }
    return out
  }
}
