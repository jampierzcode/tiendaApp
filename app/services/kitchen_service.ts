import type Business from '#models/business'
import { opcionesAgrupadas } from '#services/opciones_texto'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import OrderRound from '#models/order_round'
import Product from '#models/product'
import NotificationService from '#services/notification_service'
import { OrderError } from '#services/order_service'
import SalonService from '#services/salon_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export type EstadoCocina = 'pendiente' | 'preparando' | 'listo' | 'servido'

const ORDEN: EstadoCocina[] = ['pendiente', 'preparando', 'listo', 'servido']

/**
 * Monitor de producción (KDS): los platos de cada área con su estado.
 *
 * Funciona igual para cuentas del salón y para pedidos online: al confirmar
 * un pedido online sus platos entran a las áreas como una comanda más. Cuando
 * todas las áreas terminan un pedido online, el pedido pasa solo a "listo" y
 * se avisa al cliente.
 */
export default class KitchenService {
  /**
   * Tickets abiertos del monitor: un ticket por (cuenta, ronda, área). Trae
   * también los listos de los últimos 20 min (para "recuperar" uno tocado
   * por error) y los anulados recientes (para que cocina deje de hacerlos).
   */
  static async tickets(business: Business, areaIds: number[] | null) {
    const hace20 = DateTime.now().minus({ minutes: 20 }).toSQL()!
    const hace10 = DateTime.now().minus({ minutes: 10 }).toSQL()!
    const q = OrderItem.query()
      .where('business_id', business.id)
      .whereNotNull('kitchen_status')
      .andWhere('sent_to_kitchen_at', '>=', DateTime.now().minus({ hours: 12 }).toSQL()!)
      .where((w) => {
        w.where((a) =>
          a.whereNull('voided_at').whereIn('kitchen_status', ['pendiente', 'preparando'])
        )
          .orWhere((a) =>
            a
              .whereNull('voided_at')
              .where('kitchen_status', 'listo')
              .andWhere('ready_at', '>=', hace20)
          )
          .orWhere((a) =>
            a
              .whereNotNull('voided_at')
              .andWhere('voided_at', '>=', hace10)
              .whereNot('kitchen_status', 'servido')
          )
      })
      .preload('modifiers')
      .orderBy('sent_to_kitchen_at', 'asc')
      .orderBy('id', 'asc')
    if (areaIds?.length) q.whereIn('production_area_id', areaIds)

    const items = await q
    const ordenes = items.length
      ? await Order.query().whereIn('id', [...new Set(items.map((i) => i.orderId))])
      : []
    const ordenPorId = new Map(ordenes.map((o) => [o.id, o]))
    const rondas = await OrderRound.query().whereIn('id', [
      ...new Set(items.map((i) => i.orderRoundId).filter((v): v is number => !!v)),
    ])
    const rondaPorId = new Map(rondas.map((r) => [r.id, r]))

    const tickets = new Map<string, any>()
    for (const i of items) {
      const o = ordenPorId.get(i.orderId)
      if (!o) continue
      // Una cuenta cancelada o un pedido cancelado ya no se muestran, salvo sus anulaciones recientes.
      if (['cancelado', 'devuelto'].includes(o.status) && !i.voidedAt) continue
      const clave = `${i.orderId}-${i.orderRoundId ?? 'p'}-${i.productionAreaId ?? 0}`
      const r = i.orderRoundId ? rondaPorId.get(i.orderRoundId) : null
      if (!tickets.has(clave)) {
        tickets.set(clave, {
          clave,
          orderId: o.id,
          roundId: i.orderRoundId,
          area: i.productionAreaName ?? 'General',
          areaId: i.productionAreaId,
          canal: o.channel,
          servicio: o.service,
          etiqueta:
            o.channel === 'salon'
              ? SalonService.etiqueta(o)
              : `${o.code} · ${o.customerName}`.slice(0, 60),
          mesero: r?.userName ?? null,
          ronda: r?.number ?? null,
          nota: o.channel === 'salon' ? null : o.note,
          desde: (i.sentToKitchenAt ?? i.createdAt).toISO(),
          items: [],
        })
      }
      tickets.get(clave).items.push({
        id: i.id,
        cantidad: i.quantity,
        nombre: i.productName,
        opciones: opcionesAgrupadas(i.modifiers),
        nota: i.note,
        estado: i.kitchenStatus,
        anulado: Boolean(i.voidedAt),
        listoEn: i.readyAt?.toISO() ?? null,
      })
    }

    return [...tickets.values()].map((t) => {
      const vivos = t.items.filter((x: any) => !x.anulado)
      const estado = !vivos.length
        ? 'anulado'
        : vivos.every((x: any) => x.estado === 'listo')
          ? 'listo'
          : vivos.some((x: any) => x.estado === 'preparando' || x.estado === 'listo')
            ? 'preparando'
            : 'pendiente'
      return { ...t, estado }
    })
  }

  /**
   * Cambia el estado de cocina de varios platos (un plato o el ticket entero).
   * Solo avanza o retrocede un paso a la vez entre pendiente, preparando y listo;
   * "servido" lo marca el salón.
   */
  static async cambiar(business: Business, itemIds: number[], estado: EstadoCocina) {
    if (!['pendiente', 'preparando', 'listo'].includes(estado))
      throw new OrderError('Estado no válido')
    const ids = [...new Set((itemIds ?? []).map(Number).filter(Boolean))]
    if (!ids.length) throw new OrderError('No hay platos')

    const ordenes = new Set<number>()
    await db.transaction(async (trx) => {
      const items = await OrderItem.query({ client: trx })
        .where('business_id', business.id)
        .whereIn('id', ids)
        .whereNull('voided_at')
        .whereNotNull('kitchen_status')
        .forUpdate()
      for (const i of items) {
        if (i.kitchenStatus === 'servido') continue
        i.kitchenStatus = estado
        if (estado === 'preparando' && !i.startedAt) i.startedAt = DateTime.now()
        if (estado === 'listo') i.readyAt = DateTime.now()
        if (estado !== 'listo') i.readyAt = null
        if (estado === 'pendiente') i.startedAt = null
        i.useTransaction(trx)
        await i.save()
        ordenes.add(i.orderId)
      }
    })

    for (const id of ordenes) await this.sincronizarPedidoOnline(business, id)
    return { ok: true }
  }

  /** El salón confirma que ya llevó los platos a la mesa. */
  static async servir(business: Business, itemIds: number[]) {
    const ids = [...new Set((itemIds ?? []).map(Number).filter(Boolean))]
    await OrderItem.query()
      .where('business_id', business.id)
      .whereIn('id', ids)
      .whereNull('voided_at')
      .whereIn('kitchen_status', ['pendiente', 'preparando', 'listo'])
      .update({ kitchen_status: 'servido', served_at: DateTime.now().toSQL() })
    return { ok: true }
  }

  /**
   * Al confirmar un pedido online de un restaurante, sus platos entran a
   * producción: se les asigna su área, salen las comandas impresas y aparecen
   * en los monitores. Si ya habían entrado, no hace nada.
   */
  static async enviarPedidoOnline(business: Business, order: Order) {
    if (!business.esRestaurante || order.channel === 'salon') return
    const items = await OrderItem.query()
      .where('order_id', order.id)
      .whereNull('voided_at')
      .whereNull('kitchen_status')
      .preload('modifiers')
    if (!items.length) return

    const productos = await Product.query().whereIn('id', [
      ...new Set(items.map((i) => i.productId).filter((v): v is number => !!v)),
    ])
    const areas = await SalonService.areasDe(business, productos)
    for (const i of items) {
      const area = i.productId ? (areas.get(i.productId) ?? null) : null
      i.productionAreaId = area?.id ?? null
      i.productionAreaName = area?.name ?? null
      i.kitchenStatus = 'pendiente'
      i.sentToKitchenAt = DateTime.now()
      await i.save()
    }
    await SalonService.imprimirComandas(null, business, order, null, items, 'Pedido online', areas)
  }

  /** Pedido online cancelado con platos ya en cocina: cada área recibe el aviso. */
  static async cancelarPedidoOnline(business: Business, order: Order) {
    if (order.channel === 'salon') return
    const items = await OrderItem.query()
      .where('order_id', order.id)
      .whereIn('kitchen_status', ['pendiente', 'preparando', 'listo'])
    if (!items.length) return
    const porArea = new Map<number | null, OrderItem[]>()
    for (const i of items)
      porArea.set(i.productionAreaId, [...(porArea.get(i.productionAreaId) ?? []), i])
    for (const [areaId, lista] of porArea) {
      const area = areaId ? await db.from('production_areas').where('id', areaId).first() : null
      await SalonService.encolar(null, business, {
        kind: 'anulacion',
        printerId: area?.printer_id ?? null,
        orderId: order.id,
        payload: {
          area: lista[0].productionAreaName ?? 'General',
          servicio: order.service,
          mesa: `${order.code} · ${order.customerName}`,
          mesero: 'Pedido online',
          cuenta: order.code,
          motivo: 'PEDIDO CANCELADO',
          items: lista.map((i) => ({
            cantidad: i.quantity,
            nombre: i.productName,
            opciones: [],
            nota: null,
          })),
        },
      })
    }
  }

  /**
   * Pedido online: pasa a "preparando" cuando cocina empieza y a "listo"
   * cuando todas las áreas terminaron, con su aviso al cliente.
   */
  private static async sincronizarPedidoOnline(business: Business, orderId: number) {
    const order = await Order.find(orderId)
    if (!order || order.channel === 'salon') return
    if (!['confirmado', 'pagado', 'preparando'].includes(order.status)) return

    const filas = await db
      .from('order_items')
      .where('order_id', orderId)
      .whereNull('voided_at')
      .whereNotNull('kitchen_status')
      .select('kitchen_status')
    if (!filas.length) return
    const estados = filas.map((f) => f.kitchen_status as EstadoCocina)
    const todoListo = estados.every((e) => ORDEN.indexOf(e) >= ORDEN.indexOf('listo'))
    const empezado = estados.some((e) => e !== 'pendiente')

    let nuevo: 'preparando' | 'listo' | null = null
    if (todoListo) nuevo = 'listo'
    else if (empezado && order.status !== 'preparando') nuevo = 'preparando'
    if (!nuevo || nuevo === order.status) return

    order.status = nuevo
    if (nuevo === 'listo' && !order.readyAt) order.readyAt = DateTime.now()
    await order.save()
    try {
      await NotificationService.notificar(business, order, nuevo)
    } catch {
      // El aviso nunca debe tumbar la cocina.
    }
  }
}
