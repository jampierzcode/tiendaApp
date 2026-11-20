import type Business from '#models/business'
import CashMovement from '#models/cash_movement'
import CashRegister from '#models/cash_register'
import CashSession from '#models/cash_session'
import Shift from '#models/shift'
import { OrderError } from '#services/order_service'
import PricingService from '#services/pricing_service'
import SalonService from '#services/salon_service'
import PermissionService, { type Actor } from '#services/permission_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const r2 = PricingService.redondear
export const METODOS = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'otro'] as const

const hora = (d: DateTime | null) => (d ? d.setZone('America/Lima').toFormat('dd/LL HH:mm') : null)

/**
 * Turnos, sesiones de caja y cortes X / Z / global.
 */
export default class CashService {
  /** Qué ve el actor de los montos: todo, solo lo que contó (ciego) o nada. */
  static visibilidad(actor: Actor): 'todo' | 'ciego' | 'nada' {
    return (actor.permisos['caja.ver_esperado'] as 'todo' | 'ciego' | 'nada') ?? 'nada'
  }

  /** Para cerrar una caja ajena hace falta un permiso más. */
  private static async exigirSobreSesion(business: Business, actor: Actor, sesion: CashSession, pin?: string | null) {
    if (sesion.userId === actor.userId) {
      await PermissionService.exigir(business, actor, 'caja.operar', { pin })
    } else {
      await PermissionService.exigir(business, actor, 'caja.cerrar_otras', { pin, contexto: `Caja ${sesion.id}` })
    }
  }

  /** Cajas del negocio; si no tiene ninguna se crea "Caja principal". */
  static async cajas(business: Business) {
    let cajas = await CashRegister.query().where('business_id', business.id).andWhere('is_active', true).orderBy('id')
    if (!cajas.length) {
      cajas = [await CashRegister.create({ businessId: business.id, name: 'Caja principal', isActive: true })]
    }
    return cajas
  }

  static turnoAbierto(business: Business, trx?: TransactionClientContract) {
    return Shift.query(trx ? { client: trx } : {})
      .where('business_id', business.id)
      .andWhere('status', 'abierto')
      .first()
  }

  /**
   * Sesión en la que cae un cobro de `userId`: la suya, o la única abierta.
   * Null si no hay ninguna o si hay varias y ninguna es suya.
   */
  static async sesionPara(business: Business, userId: number, trx?: TransactionClientContract) {
    const abiertas = await CashSession.query(trx ? { client: trx } : {})
      .where('business_id', business.id)
      .andWhere('status', 'abierta')
    return abiertas.find((s) => s.userId === userId) ?? (abiertas.length === 1 ? abiertas[0] : null)
  }

  /** Lo que ve la pantalla de caja. */
  static async estado(business: Business, actor: Actor) {
    const [cajas, turno] = await Promise.all([this.cajas(business), this.turnoAbierto(business)])
    const sesiones = turno
      ? await CashSession.query().where('shift_id', turno.id).preload('register').orderBy('id', 'asc')
      : []
    const mia = await this.sesionPara(business, actor.userId)
    void mia
    const mesasAbiertas = await db
      .from('orders')
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('status', 'abierta')
      .count('* as n')
      .first()

    return {
      turno: turno
        ? { id: turno.id, number: turno.number, openedAt: turno.openedAt.toISO(), openedByName: turno.openedByName }
        : null,
      cajas: cajas.map((c) => ({
        id: c.id,
        name: c.name,
        sesionAbierta: sesiones.find((s) => s.cashRegisterId === c.id && s.status === 'abierta')?.id ?? null,
      })),
      sesiones: await Promise.all(
        sesiones.map(async (s) => ({
          id: s.id,
          caja: s.register?.name ?? '',
          status: s.status,
          userName: s.userName,
          openedAt: s.openedAt.toISO(),
          closedAt: s.closedAt?.toISO() ?? null,
          zNumber: s.zNumber,
          difference: this.visibilidad(actor) === 'todo' ? s.difference : null,
          propia: s.userId === actor.userId,
          resumen: s.status === 'abierta' && this.visibilidad(actor) === 'todo' ? await this.calcular(s) : null,
          pendientesMeseros: s.status === 'abierta' ? await this.pendientesMeseros(s, actor) : [],
        }))
      ),
      visibilidad: this.visibilidad(actor),
      permisos: {
        operar: PermissionService.tiene(actor, 'caja.operar'),
        corteX: PermissionService.tiene(actor, 'caja.corte_x'),
        cerrarOtras: PermissionService.tiene(actor, 'caja.cerrar_otras'),
        corteGlobal: PermissionService.tiene(actor, 'caja.corte_global'),
      },
      miSesion: mia?.id ?? null,
      mesasAbiertas: Number(mesasAbiertas?.n ?? 0),
    }
  }

  // --------------------------------------------------------------- apertura

  static async abrir(
    business: Business,
    actor: Actor,
    datos: { registerId?: number; openingFloat?: number; pin?: string | null }
  ) {
    await PermissionService.exigir(business, actor, 'caja.operar', { pin: datos.pin })
    const fondo = r2(Math.max(0, Number(datos.openingFloat ?? 0)))
    const cajas = await this.cajas(business)
    const elegida = Number(datos.registerId) || actor.cashRegisterId || null
    const caja = elegida ? cajas.find((c) => c.id === elegida) : cajas[0]
    if (!caja) throw new OrderError('La caja no existe')

    try {
      return await db.transaction(async (trx) => {
        let turno = await this.turnoAbierto(business, trx)
        if (!turno) {
          const ultimo = await trx.from('shifts').where('business_id', business.id).max('number as n').first()
          turno = await Shift.create(
            {
              businessId: business.id,
              number: Number(ultimo?.n ?? 0) + 1,
              status: 'abierto',
              openedByUserId: actor.userId,
              openedByName: actor.name,
              openedAt: DateTime.now(),
            },
            { client: trx }
          )
        }
        return CashSession.create(
          {
            businessId: business.id,
            shiftId: turno.id,
            cashRegisterId: caja.id,
            status: 'abierta',
            userId: actor.userId,
            userName: actor.name,
            openingFloat: fondo,
            openedAt: DateTime.now(),
          },
          { client: trx }
        )
      })
    } catch (error: any) {
      if (error?.code === '23505') throw new OrderError(`«${caja.name}» ya está abierta`)
      throw error
    }
  }

  static async crearCaja(business: Business, actor: Actor, nombre: string) {
    if (actor.role !== 'dueno') throw new OrderError('Solo el dueño crea cajas (Infraestructura → Cajas)')
    const name = String(nombre ?? '').trim().slice(0, 60)
    if (!name) throw new OrderError('Escribe el nombre de la caja')
    return CashRegister.create({ businessId: business.id, name, isActive: true })
  }

  // ------------------------------------------------------------ movimientos

  static async movimiento(
    business: Business,
    actor: Actor,
    sessionId: number,
    datos: { type: string; amount: number; reason: string; pin?: string | null }
  ) {
    const sesion = await this.sesionAbierta(business, sessionId)
    await this.exigirSobreSesion(business, actor, sesion, datos.pin)
    const monto = r2(Number(datos.amount))
    if (!Number.isFinite(monto) || monto <= 0) throw new OrderError('Monto no válido')
    const motivo = String(datos.reason ?? '').trim().slice(0, 160)
    if (!motivo) throw new OrderError('Escribe el motivo')
    const tipo = datos.type === 'ingreso' ? 'ingreso' : 'retiro'
    if (tipo === 'retiro') {
      const r = await this.calcular(sesion)
      if (monto > r.efectivoEsperado + 0.009) {
        throw new OrderError(
          this.visibilidad(actor) === 'todo'
            ? `En caja debería haber ${r.efectivoEsperado.toFixed(2)} en efectivo`
            : 'El retiro es mayor que el efectivo que hay en caja'
        )
      }
    }
    return CashMovement.create({
      businessId: business.id,
      cashSessionId: sesion.id,
      type: tipo,
      amount: monto,
      reason: motivo,
      userId: actor.userId,
      userName: actor.name,
    })
  }

  // ------------------------------------------------------------------ cortes

  private static async sesionAbierta(business: Business, id: number, trx?: TransactionClientContract) {
    const s = await CashSession.query(trx ? { client: trx } : {})
      .where('business_id', business.id)
      .andWhere('id', id)
      .preload('register')
      .first()
    if (!s) throw new OrderError('Sesión de caja no encontrada')
    if (s.status !== 'abierta') throw new OrderError('Esa caja ya está cerrada')
    return s
  }

  /** Números de una sesión: cobros por método, movimientos y efectivo esperado. */
  static async calcular(sesion: CashSession, trx?: TransactionClientContract) {
    const cliente = trx ?? db
    const pagos = await cliente
      .from('payments')
      .where('cash_session_id', sesion.id)
      .groupBy('method')
      .select('method', cliente.raw('SUM(amount) as total'), cliente.raw('COUNT(DISTINCT order_id) as pedidos'))
    const ventas = await cliente
      .from('payments')
      .where('cash_session_id', sesion.id)
      .countDistinct('order_id as n')
      .first()
    const movs = await cliente
      .from('cash_movements')
      .where('cash_session_id', sesion.id)
      .orderBy('id', 'asc')
      .select('type', 'amount', 'reason', 'user_name', 'created_at')

    const porMetodo: Record<string, number> = {}
    for (const p of pagos) porMetodo[p.method] = r2(Number(p.total))
    const ingresos = r2(movs.filter((m) => m.type === 'ingreso').reduce((t, m) => t + Number(m.amount), 0))
    const retiros = r2(movs.filter((m) => m.type === 'retiro').reduce((t, m) => t + Number(m.amount), 0))
    const efectivoEsperado = r2(Number(sesion.openingFloat) + (porMetodo.efectivo ?? 0) + ingresos - retiros)
    const totalVentas = r2(Object.values(porMetodo).reduce((t, v) => t + v, 0))

    // Lo que debería haber por método al cerrar: el efectivo con fondo y movimientos.
    const esperado: Record<string, number> = { ...porMetodo, efectivo: efectivoEsperado }

    return {
      fondo: Number(sesion.openingFloat),
      porMetodo,
      totalVentas,
      ventas: Number(ventas?.n ?? 0),
      ingresos,
      retiros,
      movimientos: movs.map((m) => ({
        type: m.type,
        amount: Number(m.amount),
        reason: m.reason,
        userName: m.user_name,
        createdAt: m.created_at,
      })),
      efectivoEsperado,
      esperado,
    }
  }

  private static payloadCorte(business: Business, sesion: CashSession, r: Awaited<ReturnType<typeof CashService.calcular>>) {
    return {
      negocio: business.name,
      simbolo: business.currencySymbol || 'S/',
      caja: sesion.register?.name ?? '',
      usuario: sesion.userName,
      apertura: hora(sesion.openedAt),
      fondo: r.fondo,
      porMetodo: Object.entries(r.porMetodo).map(([metodo, monto]) => ({ metodo, monto })),
      totalVentas: r.totalVentas,
      ventas: r.ventas,
      ingresos: r.ingresos,
      retiros: r.retiros,
      efectivoEsperado: r.efectivoEsperado,
    }
  }

  /** Corte X: cómo va la caja, sin cerrarla. */
  static async corteX(business: Business, actor: Actor, sessionId: number, imprimir = true, pin?: string | null) {
    await PermissionService.exigir(business, actor, 'caja.corte_x', { pin, contexto: `Corte X caja ${sessionId}` })
    const sesion = await this.sesionAbierta(business, sessionId)
    const r = await this.calcular(sesion)
    if (imprimir) {
      await SalonService.encolar(null, business, {
        kind: 'corte_x',
        printerId: null,
        orderId: null,
        payload: { ...this.payloadCorte(business, sesion, r), pedidoPor: actor.name },
      })
    }
    return { sesionId: sesion.id, caja: sesion.register?.name, usuario: sesion.userName, openedAt: sesion.openedAt.toISO(), ...r }
  }

  /**
   * Corte Z: quien cierra declara lo que contó por método. Se guarda lo
   * esperado, lo declarado y la diferencia, y la sesión se cierra.
   */
  static async corteZ(
    business: Business,
    actor: Actor,
    sessionId: number,
    datos: { declared: Record<string, unknown>; note?: string | null; pin?: string | null }
  ) {
    const previa = await this.sesionAbierta(business, sessionId)
    await this.exigirSobreSesion(business, actor, previa, datos.pin)
    const faltan = await this.pendientesMeseros(previa)
    if (faltan.some((p) => !p.declarado)) {
      throw new OrderError(
        `Antes del corte Z recibe lo cobrado por: ${faltan
          .filter((p) => !p.declarado)
          .map((p) => p.nombre)
          .join(', ')}`
      )
    }

    const declarado: Record<string, number> = {}
    for (const m of METODOS) {
      const v = datos.declared?.[m]
      if (v === undefined || v === null || v === '') continue
      const n = r2(Number(v))
      if (!Number.isFinite(n) || n < 0) throw new OrderError(`Monto no válido en ${m}`)
      declarado[m] = n
    }

    const resultado = await db.transaction(async (trx) => {
      const sesion = await this.sesionAbierta(business, sessionId, trx)
      await trx.from('cash_sessions').where('id', sesion.id).forUpdate().first()
      const r = await this.calcular(sesion, trx)

      // Lo no declarado de un método con movimiento se toma como 0: faltante a la vista.
      for (const m of Object.keys(r.esperado)) if (declarado[m] === undefined) declarado[m] = 0
      const diferencias: Record<string, number> = {}
      for (const m of new Set([...Object.keys(r.esperado), ...Object.keys(declarado)])) {
        diferencias[m] = r2((declarado[m] ?? 0) - (r.esperado[m] ?? 0))
      }
      const diferencia = r2(Object.values(diferencias).reduce((t, v) => t + v, 0))

      const ultimo = await trx.from('cash_sessions').where('business_id', business.id).max('z_number as n').first()
      sesion.merge({
        status: 'cerrada',
        closedAt: DateTime.now(),
        closedByUserId: actor.userId,
        closedByName: actor.name,
        zNumber: Number(ultimo?.n ?? 0) + 1,
        declared: declarado,
        expected: r.esperado,
        difference: diferencia,
        note: datos.note?.trim().slice(0, 255) || null,
      })
      sesion.useTransaction(trx)
      await sesion.save()
      return { sesion, r, diferencias, diferencia }
    })

    const { sesion, r, diferencias, diferencia } = resultado
    const payload = {
      ...this.payloadCorte(business, sesion, r),
      z: sesion.zNumber,
      cierre: hora(sesion.closedAt),
      cerradoPor: actor.name,
      lineas: Object.keys(diferencias).map((m) => ({
        metodo: m,
        esperado: r.esperado[m] ?? 0,
        declarado: sesion.declared?.[m] ?? 0,
        diferencia: diferencias[m],
      })),
      diferencia,
      nota: sesion.note,
    }
    // El ticket del Z muestra lo esperado solo si quien cierra puede verlo;
    // si no, sale lo declarado y el dueño ve la diferencia en el panel.
    const vis = this.visibilidad(actor)
    const impreso =
      vis === 'todo'
        ? payload
        : {
            ...payload,
            ciego: true,
            porMetodo: [],
            totalVentas: null,
            efectivoEsperado: null,
            ingresos: null,
            retiros: null,
            diferencia: null,
            lineas: payload.lineas.map((l) => ({ metodo: l.metodo, declarado: l.declarado })),
          }
    await SalonService.encolar(null, business, { kind: 'corte_z', printerId: null, orderId: null, payload: impreso })
    return vis === 'nada' ? { z: payload.z, cerrada: true, ciego: true } : impreso
  }

  // ------------------------------------------------- lo que cobran los meseros

  /**
   * Quién, aparte del responsable de la caja, cobró dentro de ella y cuánto
   * tiene que entregar por método. `esperado` solo se muestra a quien puede ver.
   */
  static async pendientesMeseros(sesion: CashSession, actor?: Actor) {
    const filas = await db
      .from('payments')
      .where('cash_session_id', sesion.id)
      .whereNotNull('user_id')
      .whereNot('user_id', sesion.userId ?? 0)
      .groupBy('user_id', 'method')
      .select('user_id', 'method', db.raw('SUM(amount) as total'))
    const ya = await db.from('cash_collector_declarations').where('cash_session_id', sesion.id)
    const porUsuario = new Map<number, Record<string, number>>()
    for (const f of filas) {
      const m = porUsuario.get(f.user_id) ?? {}
      m[f.method] = r2(Number(f.total))
      porUsuario.set(f.user_id, m)
    }
    const ids = [...porUsuario.keys()]
    const nombres = new Map<number, string>()
    if (ids.length) {
      for (const s of await db.from('business_staff').whereIn('user_id', ids).select('user_id', 'name')) nombres.set(s.user_id, s.name)
      for (const u of await db.from('users').whereIn('id', ids).select('id', 'name')) if (!nombres.has(u.id)) nombres.set(u.id, u.name)
    }
    const ver = !actor || this.visibilidad(actor) === 'todo'
    return ids.map((id) => {
      const d = ya.find((x) => x.user_id === id)
      return {
        userId: id,
        nombre: nombres.get(id) ?? 'Mesero',
        metodos: Object.keys(porUsuario.get(id)!),
        esperado: ver ? porUsuario.get(id)! : null,
        declarado: d ? JSON.parse(d.declared) : null,
        diferencia: d && ver ? Number(d.difference) : null,
        recibidoPor: d?.received_by_name ?? null,
      }
    })
  }

  /** El responsable de la caja recibe lo que cobró un mesero y lo deja declarado. */
  static async recibirDeMesero(
    business: Business,
    actor: Actor,
    sessionId: number,
    datos: { userId: number; declared: Record<string, unknown>; pin?: string | null }
  ) {
    const sesion = await this.sesionAbierta(business, sessionId)
    await this.exigirSobreSesion(business, actor, sesion, datos.pin)
    const pendientes = await this.pendientesMeseros(sesion)
    const p = pendientes.find((x) => x.userId === Number(datos.userId))
    if (!p) throw new OrderError('Ese mesero no cobró en esta caja')
    if (p.declarado) throw new OrderError('Ya se recibió lo de este mesero')

    const declarado: Record<string, number> = {}
    for (const m of p.metodos) {
      const n = r2(Number(datos.declared?.[m] ?? 0))
      if (!Number.isFinite(n) || n < 0) throw new OrderError(`Monto no válido en ${m}`)
      declarado[m] = n
    }
    const esperado = p.esperado!
    const diferencia = r2(p.metodos.reduce((t, m) => t + (declarado[m] ?? 0) - (esperado[m] ?? 0), 0))
    await db.table('cash_collector_declarations').insert({
      business_id: business.id,
      cash_session_id: sesion.id,
      user_id: p.userId,
      user_name: p.nombre,
      declared: JSON.stringify(declarado),
      expected: JSON.stringify(esperado),
      difference: diferencia,
      received_by_user_id: actor.userId,
      received_by_name: actor.name,
      created_at: new Date(),
    })
    return this.visibilidad(actor) === 'todo' ? { declarado, esperado, diferencia } : { declarado }
  }

  /**
   * Corte global: cierra el turno con todas sus cajas ya cerradas y deja el
   * resumen del día (ventas, métodos, diferencias, anulaciones y más vendidos).
   */
  static async cierreGlobal(business: Business, actor: Actor, opciones: { force?: boolean; pin?: string | null } = {}) {
    await PermissionService.exigir(business, actor, 'caja.corte_global', { pin: opciones.pin, contexto: 'Corte global' })
    const turno = await this.turnoAbierto(business)
    if (!turno) throw new OrderError('No hay un turno abierto')

    const sesiones = await CashSession.query().where('shift_id', turno.id).preload('register').orderBy('id')
    const abiertas = sesiones.filter((s) => s.status === 'abierta')
    if (abiertas.length) {
      throw new OrderError(
        `Primero haz el corte Z de: ${abiertas.map((s) => `${s.register?.name} (${s.userName})`).join(', ')}`
      )
    }
    const mesas = await db
      .from('orders')
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('status', 'abierta')
      .count('* as n')
      .first()
    if (Number(mesas?.n ?? 0) > 0 && !opciones.force) {
      throw new OrderError(`Hay ${mesas!.n} mesa(s) con cuenta abierta. Cóbralas o confirma cerrar igual.`)
    }

    const ids = sesiones.map((s) => s.id)
    const desde = turno.openedAt.toSQL()!
    const ahora = DateTime.now()

    const porMetodoFilas = ids.length
      ? await db.from('payments').whereIn('cash_session_id', ids).groupBy('method').select('method', db.raw('SUM(amount) as total'))
      : []
    const porMetodo = porMetodoFilas.map((f) => ({ metodo: f.method, monto: r2(Number(f.total)) }))
    const total = r2(porMetodo.reduce((t, m) => t + m.monto, 0))
    const ventasFila = ids.length
      ? await db.from('payments').whereIn('cash_session_id', ids).countDistinct('order_id as n').first()
      : { n: 0 }
    const ventas = Number(ventasFila?.n ?? 0)

    const pedidosIds = ids.length
      ? (await db.from('payments').whereIn('cash_session_id', ids).distinct('order_id')).map((f) => f.order_id)
      : []

    const descuentosFila = pedidosIds.length
      ? await db.from('orders').whereIn('id', pedidosIds).sum('discount_total as d').first()
      : { d: 0 }

    const anuladas = await db
      .from('order_items')
      .where('business_id', business.id)
      .whereNotNull('voided_at')
      .andWhere('voided_at', '>=', desde)
      .select(db.raw('COUNT(*) as n'), db.raw('COALESCE(SUM(line_total),0) as monto'))
      .first()

    const canceladas = await db
      .from('orders')
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('status', 'cancelado')
      .andWhere('closed_at', '>=', desde)
      .count('* as n')
      .first()

    const top = pedidosIds.length
      ? await db
          .from('order_items')
          .whereIn('order_id', pedidosIds)
          .whereNull('voided_at')
          .groupBy('product_name')
          .select('product_name', db.raw('SUM(quantity) as cantidad'), db.raw('SUM(line_total) as total'))
          .orderBy('cantidad', 'desc')
          .limit(5)
      : []

    const resumen = {
      negocio: business.name,
      simbolo: business.currencySymbol || 'S/',
      turno: turno.number,
      apertura: hora(turno.openedAt),
      cierre: hora(ahora),
      abiertoPor: turno.openedByName,
      cerradoPor: actor.name,
      sesiones: sesiones.map((s) => ({
        caja: s.register?.name ?? '',
        usuario: s.userName,
        z: s.zNumber,
        esperado: r2(Object.values(s.expected ?? {}).reduce((t, v) => t + Number(v), 0)),
        declarado: r2(Object.values(s.declared ?? {}).reduce((t, v) => t + Number(v), 0)),
        diferencia: Number(s.difference ?? 0),
      })),
      porMetodo,
      total,
      ventas,
      ticketPromedio: ventas ? r2(total / ventas) : 0,
      diferencia: r2(sesiones.reduce((t, s) => t + Number(s.difference ?? 0), 0)),
      descuentos: r2(Number(descuentosFila?.d ?? 0)),
      anulaciones: { cantidad: Number(anuladas?.n ?? 0), monto: r2(Number(anuladas?.monto ?? 0)) },
      cuentasCanceladas: Number(canceladas?.n ?? 0),
      mesasAbiertas: Number(mesas?.n ?? 0),
      top: top.map((t) => ({ nombre: t.product_name, cantidad: Number(t.cantidad), total: r2(Number(t.total)) })),
    }

    turno.merge({
      status: 'cerrado',
      closedAt: ahora,
      closedByUserId: actor.userId,
      closedByName: actor.name,
      summary: resumen,
    })
    await turno.save()

    await SalonService.encolar(null, business, { kind: 'corte_global', printerId: null, orderId: null, payload: resumen })
    return resumen
  }

  /** Turnos cerrados, para consultar o reimprimir. */
  static async historial(business: Business) {
    const turnos = await Shift.query()
      .where('business_id', business.id)
      .andWhere('status', 'cerrado')
      .orderBy('id', 'desc')
      .limit(30)
    return turnos.map((t) => ({ id: t.id, number: t.number, openedAt: t.openedAt.toISO(), closedAt: t.closedAt?.toISO(), summary: t.summary }))
  }

  static async reimprimirGlobal(business: Business, actor: Actor, shiftId: number) {
    await PermissionService.exigir(business, actor, 'caja.corte_global')
    const t = await Shift.query().where('business_id', business.id).andWhere('id', shiftId).first()
    if (!t?.summary) throw new OrderError('Turno no encontrado')
    await SalonService.encolar(null, business, { kind: 'corte_global', printerId: null, orderId: null, payload: t.summary })
    return { ok: true }
  }
}
