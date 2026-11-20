import type Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import DiningTable from '#models/dining_table'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import OrderItemModifier from '#models/order_item_modifier'
import OrderRound from '#models/order_round'
import Payment from '#models/payment'
import PrintJob, { type PrintKind } from '#models/print_job'
import Product from '#models/product'
import ProductModifierGroup from '#models/product_modifier_group'
import ProductionArea from '#models/production_area'
import IngredientService from '#services/ingredient_service'
import OrderService, { OrderError, type LineaMenu } from '#services/order_service'
import PosService, { type CobroMostrador } from '#services/pos_service'
import PricingService from '#services/pricing_service'
import PromotionService from '#services/promotion_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

/** Quién hace la operación: el dueño o alguien del personal. */
export interface Actor {
  userId: number
  name: string
  role: 'dueno' | 'cajero' | 'mesero'
}

export interface DatosComanda {
  tableId: number
  /** Generado por el celular: si reintenta sin señal, la ronda no se duplica. */
  clientRequestId: string
  guests?: number | null
  items: LineaMenu[]
}

const r2 = PricingService.redondear

/**
 * PDV de salón: cuentas abiertas por mesa.
 *
 * La cuenta es un `order` (channel 'salon', status 'abierta') para que los
 * cobros, los reportes y el consumo de insumos sigan en un solo sitio. Cada
 * "Enviar comanda" es una ronda y genera un trabajo de impresión por área.
 */
export default class SalonService {
  static puedeCobrar(actor: Actor) {
    return actor.role !== 'mesero'
  }

  private static exigirCaja(actor: Actor) {
    if (!this.puedeCobrar(actor)) {
      throw new OrderError('Solo el dueño o caja puede hacer esto')
    }
  }

  // ---------------------------------------------------------------- lectura

  /** Mesas con su cuenta abierta (si tienen). */
  static async mesas(business: Business) {
    const mesas = await DiningTable.query()
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')

    const abiertas = await Order.query()
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('status', 'abierta')
      .withCount('items', (q) => q.whereNull('voided_at'))

    const meseros = await this.nombresDeUsuarios(abiertas.map((o) => o.openedByUserId))
    const porMesa = new Map(abiertas.map((o) => [o.diningTableId, o]))

    return mesas.map((m) => {
      const o = porMesa.get(m.id)
      return {
        id: m.id,
        name: m.name,
        zone: m.zone,
        seats: m.seats,
        cuenta: o
          ? {
              id: o.id,
              code: o.code,
              total: Number(o.total),
              guests: o.guests,
              items: Number(o.$extras.items_count ?? 0),
              abiertaDesde: o.createdAt.toISO(),
              mesero: o.openedByUserId ? (meseros.get(o.openedByUserId) ?? null) : null,
            }
          : null,
      }
    })
  }

  /** Carta para comandar: platos activos con sus modificadores. */
  static async menu(business: Business) {
    const products = await Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .preload('businessImages')
      .preload('categoryLinks')
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')

    const reglas = await ProductModifierGroup.query()
      .where('business_id', business.id)
      .preload('group', (g) =>
        g.where('is_active', true).preload('options', (o) => o.where('is_active', true).orderBy('sort_order', 'asc'))
      )
      .orderBy('sort_order', 'asc')

    const gruposPorProducto = new Map<number, any[]>()
    for (const r of reglas) {
      if (!r.group) continue
      const lista = gruposPorProducto.get(r.productId) ?? []
      lista.push({
        groupId: r.group.id,
        name: r.group.name,
        minSelect: r.minSelect,
        maxSelect: r.maxSelect,
        options: r.group.options.map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.priceDelta) })),
      })
      gruposPorProducto.set(r.productId, lista)
    }

    const categorias = await Category.query()
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')

    const promos = await PromotionService.activas(business.id)

    return {
      categorias: categorias.map((c) => ({ id: c.id, name: c.name })),
      platos: products.map((p) => {
        const precio = PromotionService.precioPublico(
          promos,
          p.id,
          p.categoryLinks.map((l) => l.categoryId),
          Number(p.price)
        )
        return {
          id: p.id,
          name: p.name,
          imageUrl: p.businessImages?.url ?? null,
          price: precio.final,
          categoryIds: p.categoryLinks.map((l) => l.categoryId),
          modifierGroups: gruposPorProducto.get(p.id) ?? [],
        }
      }),
    }
  }

  /** La cuenta completa de una mesa, con rondas, anulados y pagos. */
  static async cuenta(business: Business, orderId: number) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', orderId)
      .andWhere('channel', 'salon')
      .preload('items', (q) => q.preload('modifiers').orderBy('id', 'asc'))
      .preload('payments')
      .first()
    if (!order) throw new OrderError('Cuenta no encontrada')

    const rondas = await OrderRound.query().where('order_id', order.id).orderBy('number', 'asc')
    const mesa = order.diningTableId ? await DiningTable.find(order.diningTableId) : null

    return {
      id: order.id,
      code: order.code,
      status: order.status,
      mesa: mesa ? { id: mesa.id, name: mesa.name } : { id: null, name: order.tableLabel },
      guests: order.guests,
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      total: Number(order.total),
      paidTotal: Number(order.paidTotal),
      documento: order.documentSeries ? `${order.documentSeries}-${String(order.documentNumber).padStart(6, '0')}` : null,
      abiertaDesde: order.createdAt.toISO(),
      cerradaEn: order.closedAt?.toISO() ?? null,
      rondas: rondas.map((r) => ({
        id: r.id,
        number: r.number,
        userName: r.userName,
        createdAt: r.createdAt.toISO(),
      })),
      items: order.items.map((i) => ({
        id: i.id,
        roundId: i.orderRoundId,
        productId: i.productId,
        name: i.productName,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        note: i.note,
        area: i.productionAreaName,
        modifiers: i.modifiers.map((m) => ({ name: m.optionName, quantity: m.quantity })),
        voided: Boolean(i.voidedAt),
        voidReason: i.voidReason,
      })),
      payments: order.payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    }
  }

  // --------------------------------------------------------------- comandar

  /**
   * Envía una ronda de la mesa. Abre la cuenta si la mesa estaba libre.
   * Es idempotente por `clientRequestId`: el celular de la mesera puede
   * reintentar las veces que quiera sin duplicar platos.
   */
  static async comandar(business: Business, actor: Actor, datos: DatosComanda) {
    const requestId = String(datos.clientRequestId ?? '').trim().slice(0, 64)
    if (!requestId) throw new OrderError('Falta el identificador de la comanda')

    const repetida = await OrderRound.query()
      .where('business_id', business.id)
      .andWhere('client_request_id', requestId)
      .first()
    if (repetida) return { orderId: repetida.orderId, roundId: repetida.id, repetida: true }

    const mesa = await DiningTable.query()
      .where('business_id', business.id)
      .andWhere('id', Number(datos.tableId))
      .andWhere('is_active', true)
      .first()
    if (!mesa) throw new OrderError('La mesa no existe')

    // Validación y precios fuera de la transacción: no escribe nada.
    const { lineas } = await OrderService.prepararLineasMenu(business, datos.items, null)
    const areas = await this.areasDe(business, lineas.map((l) => l.producto))

    const ejecutar = () =>
      db.transaction(async (trx) => {
        let order = await Order.query({ client: trx })
          .where('business_id', business.id)
          .andWhere('dining_table_id', mesa.id)
          .andWhere('status', 'abierta')
          .forUpdate()
          .first()

        if (!order) {
          order = await Order.create(
            {
              businessId: business.id,
              code: await OrderService.siguienteCodigo(business, trx),
              channel: 'salon',
              status: 'abierta',
              customerName: `Mesa ${mesa.name}`,
              customerPhone: null,
              deliveryMethod: 'mesa',
              tableLabel: mesa.name,
              diningTableId: mesa.id,
              guests: datos.guests ? Math.max(1, Math.floor(Number(datos.guests))) : null,
              openedByUserId: actor.userId,
              currency: business.currency,
              subtotal: 0,
              discountTotal: 0,
              shippingCost: 0,
              total: 0,
              paidTotal: 0,
            },
            { client: trx }
          )
        }

        const anteriores = await OrderRound.query({ client: trx }).where('order_id', order.id).count('* as n')
        const ronda = await OrderRound.create(
          {
            businessId: business.id,
            orderId: order.id,
            number: Number(anteriores[0].$extras.n) + 1,
            clientRequestId: requestId,
            userId: actor.userId,
            userName: actor.name,
          },
          { client: trx }
        )

        const creados: { item: OrderItem; mods: string[] }[] = []
        let bruto = 0
        for (const l of lineas) {
          const area = areas.get(l.producto.id) ?? null
          bruto += l.bruto
          const item = await OrderItem.create(
            {
              businessId: business.id,
              orderId: order.id,
              orderRoundId: ronda.id,
              productId: l.producto.id,
              productVariationId: l.producto.defaultVariation?.id ?? null,
              productName: l.producto.name,
              sku: l.producto.sku,
              variationLabel: null,
              unitPrice: r2(l.lineTotal / l.cantidad),
              unitCost: l.producto.cost,
              discountPercentage: l.bruto > 0 ? r2((l.mejor.ahorro / l.bruto) * 100) : 0,
              promotionName: l.mejor.promo?.name ?? null,
              quantity: l.cantidad,
              lineTotal: l.lineTotal,
              note: l.item.note?.trim().slice(0, 255) || null,
              productionAreaId: area?.id ?? null,
              productionAreaName: area?.name ?? null,
            },
            { client: trx }
          )
          const mods: string[] = []
          for (const m of l.modificadores) {
            await OrderItemModifier.create(
              {
                businessId: business.id,
                orderItemId: item.id,
                modifierOptionId: m.option.id,
                groupName: m.groupName,
                optionName: m.option.name,
                priceDelta: Number(m.option.priceDelta),
                quantity: m.quantity,
              },
              { client: trx }
            )
            mods.push(m.quantity > 1 ? `${m.quantity}x ${m.option.name}` : m.option.name)
          }
          creados.push({ item, mods })
        }

        order.subtotal = r2(Number(order.subtotal) + bruto)
        order.useTransaction(trx)
        await this.recalcular(order, trx)

        // Un ticket por área. Lo que no tiene área sale por la impresora de caja.
        const porArea = new Map<number | null, typeof creados>()
        for (const c of creados) {
          const k = c.item.productionAreaId ?? null
          porArea.set(k, [...(porArea.get(k) ?? []), c])
        }
        for (const [areaId, lista] of porArea) {
          const area = areaId ? [...areas.values()].find((a) => a?.id === areaId) : null
          await this.encolar(trx, business, {
            kind: 'comanda',
            printerId: area?.printerId ?? null,
            orderId: order.id,
            payload: {
              area: area?.name ?? 'General',
              mesa: mesa.name,
              mesero: actor.name,
              ronda: ronda.number,
              cuenta: order.code,
              items: lista.map((c) => ({
                cantidad: c.item.quantity,
                nombre: c.item.productName,
                opciones: c.mods,
                nota: c.item.note,
              })),
            },
          })
        }

        return { orderId: order.id, roundId: ronda.id, repetida: false }
      })

    try {
      return await ejecutar()
    } catch (error: any) {
      // Dos meseras abrieron la misma mesa a la vez, o el reintento llegó
      // junto con el original: el índice único lo frena y se reintenta una vez.
      if (error?.code === '23505') {
        const ya = await OrderRound.query()
          .where('business_id', business.id)
          .andWhere('client_request_id', requestId)
          .first()
        if (ya) return { orderId: ya.orderId, roundId: ya.id, repetida: true }
        return ejecutar()
      }
      throw error
    }
  }

  /**
   * Área de cada plato: la suya, o la de su primera categoría que tenga una.
   */
  private static async areasDe(business: Business, productos: Product[]) {
    const areas = await ProductionArea.query().where('business_id', business.id).andWhere('is_active', true)
    const areaPorId = new Map(areas.map((a) => [a.id, a]))
    const resultado = new Map<number, ProductionArea | null>()

    const sinPropia = productos.filter((p) => !p.productionAreaId || !areaPorId.has(p.productionAreaId))
    const porCategoria = new Map<number, number>()
    if (sinPropia.length) {
      const links = await CategoryProduct.query()
        .whereIn(
          'product_id',
          sinPropia.map((p) => p.id)
        )
        .preload('category')
        .orderBy('id', 'asc')
      for (const l of links) {
        const a = l.category?.productionAreaId
        if (a && areaPorId.has(a) && !porCategoria.has(l.productId)) porCategoria.set(l.productId, a)
      }
    }

    for (const p of productos) {
      const id =
        p.productionAreaId && areaPorId.has(p.productionAreaId) ? p.productionAreaId : porCategoria.get(p.id)
      resultado.set(p.id, id ? (areaPorId.get(id) ?? null) : null)
    }
    return resultado
  }

  /** Total = suma de lo no anulado; el descuento es lo que separa del subtotal. */
  private static async recalcular(order: Order, trx: TransactionClientContract) {
    const fila = await trx
      .from('order_items')
      .where('order_id', order.id)
      .whereNull('voided_at')
      .sum('line_total as total')
      .first()
    const total = r2(Number(fila?.total ?? 0))
    order.total = total
    // Sin nada vigente no queda subtotal (cuenta cancelada o todo anulado).
    order.subtotal = total === 0 ? 0 : r2(Math.max(Number(order.subtotal), total))
    order.discountTotal = r2(Number(order.subtotal) - total)
    await order.save()
  }

  // --------------------------------------------------------------- anular

  /**
   * Anula un plato ya comandado (o parte: 1 de 3 gaseosas). Queda en la
   * cuenta tachado, con motivo y quién lo hizo, y sale un aviso a su área.
   */
  static async anularItem(
    business: Business,
    actor: Actor,
    itemId: number,
    datos: { reason: string; quantity?: number }
  ) {
    this.exigirCaja(actor)
    const motivo = String(datos.reason ?? '').trim().slice(0, 160)
    if (!motivo) throw new OrderError('Escribe el motivo de la anulación')

    return db.transaction(async (trx) => {
      const item = await OrderItem.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', itemId)
        .preload('modifiers')
        .forUpdate()
        .first()
      if (!item) throw new OrderError('Plato no encontrado')
      if (item.voidedAt) throw new OrderError('Ese plato ya está anulado')

      const order = await Order.query({ client: trx }).where('id', item.orderId).forUpdate().firstOrFail()
      if (order.channel !== 'salon' || order.status !== 'abierta') {
        throw new OrderError('Solo se anulan platos de una cuenta abierta')
      }

      const cantidad = Math.floor(Number(datos.quantity ?? item.quantity))
      if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > item.quantity) {
        throw new OrderError(`Puedes anular entre 1 y ${item.quantity}`)
      }

      let anulado = item
      if (cantidad < item.quantity) {
        // Se parte la línea: la que queda y la anulada, cada una con su total.
        const unit = Number(item.lineTotal) / item.quantity
        anulado = await OrderItem.create(
          {
            ...item.$attributes,
            id: undefined,
            quantity: cantidad,
            lineTotal: r2(unit * cantidad),
          } as any,
          { client: trx }
        )
        for (const m of item.modifiers) {
          await OrderItemModifier.create(
            { ...m.$attributes, id: undefined, orderItemId: anulado.id } as any,
            { client: trx }
          )
        }
        item.quantity -= cantidad
        item.lineTotal = r2(Number(item.lineTotal) - Number(anulado.lineTotal))
        item.useTransaction(trx)
        await item.save()
      }

      anulado.voidedAt = DateTime.now()
      anulado.voidReason = motivo
      anulado.voidedByUserId = actor.userId
      anulado.useTransaction(trx)
      await anulado.save()

      // Lo anulado sale también del subtotal; si no, se vería como descuento.
      const pct = Number(anulado.discountPercentage ?? 0)
      const brutoAnulado = pct > 0 && pct < 100 ? Number(anulado.lineTotal) / (1 - pct / 100) : Number(anulado.lineTotal)
      order.subtotal = r2(Math.max(0, Number(order.subtotal) - brutoAnulado))
      order.useTransaction(trx)
      await this.recalcular(order, trx)

      const area = anulado.productionAreaId ? await ProductionArea.find(anulado.productionAreaId, { client: trx }) : null
      await this.encolar(trx, business, {
        kind: 'anulacion',
        printerId: area?.printerId ?? null,
        orderId: order.id,
        payload: {
          area: anulado.productionAreaName ?? 'General',
          mesa: order.tableLabel,
          mesero: actor.name,
          cuenta: order.code,
          motivo,
          items: [{ cantidad, nombre: anulado.productName, opciones: [], nota: null }],
        },
      })

      return { orderId: order.id }
    })
  }

  // ------------------------------------------------------- precuenta / cobro

  /** Imprime la precuenta en la impresora de caja. Cualquiera puede pedirla. */
  static async precuenta(business: Business, actor: Actor, orderId: number) {
    const datos = await this.cuenta(business, orderId)
    if (datos.status !== 'abierta') throw new OrderError('La cuenta ya está cerrada')
    await this.encolar(null, business, {
      kind: 'precuenta',
      printerId: null,
      orderId,
      payload: { ...this.ticketBase(business, datos), pedidoPor: actor.name },
    })
    return datos
  }

  /**
   * Cobra y cierra la cuenta: registra los pagos, numera la nota de venta,
   * descuenta insumos y manda el ticket a la impresora de caja.
   */
  static async cobrar(
    business: Business,
    actor: Actor,
    orderId: number,
    datos: { payments: CobroMostrador[]; discountPercentage?: number; customerName?: string | null }
  ) {
    this.exigirCaja(actor)

    const resultado = await db.transaction(async (trx) => {
      const order = await Order.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', orderId)
        .andWhere('channel', 'salon')
        .forUpdate()
        .first()
      if (!order) throw new OrderError('Cuenta no encontrada')
      if (order.status !== 'abierta') throw new OrderError('La cuenta ya está cerrada')

      order.useTransaction(trx)
      await this.recalcular(order, trx)
      if (Number(order.total) <= 0) throw new OrderError('La cuenta no tiene nada que cobrar')

      const pct = Math.min(Math.max(Number(datos.discountPercentage ?? 0), 0), 100)
      const rebaja = r2((Number(order.total) * pct) / 100)
      const total = r2(Number(order.total) - rebaja)

      const cobrado = r2((datos.payments ?? []).reduce((t, p) => t + Number(p.amount || 0), 0))
      if (cobrado < total - 0.009) {
        throw new OrderError(`Falta cobrar: el total es ${total.toFixed(2)} y se registraron ${cobrado.toFixed(2)}`)
      }

      // Lo que se recibe de más es vuelto, no pago.
      let restante = total
      for (const pago of datos.payments) {
        if (restante <= 0) break
        const monto = r2(Math.min(Number(pago.amount), restante))
        if (monto <= 0) continue
        restante = r2(restante - monto)
        await Payment.create(
          {
            businessId: business.id,
            orderId: order.id,
            method: pago.method,
            amount: monto,
            reference: pago.reference?.trim() || null,
            note: pago.note?.trim() || null,
            receiptImageId: pago.receiptImageId ?? null,
            paidAt: DateTime.now(),
            userId: actor.userId,
          },
          { client: trx }
        )
      }

      const { serie, numero } = await PosService.siguienteTicket(business, trx)
      order.documentSeries = serie
      order.documentNumber = numero
      order.discountTotal = r2(Number(order.discountTotal) + rebaja)
      order.total = total
      order.paidTotal = total
      order.status = 'entregado'
      order.closedAt = DateTime.now()
      order.deliveredAt = DateTime.now()
      if (datos.customerName?.trim()) order.customerName = datos.customerName.trim().slice(0, 120)

      if (business.esRestaurante && !order.stockCommittedAt) {
        await IngredientService.consumirPedido(order, trx, actor.userId)
        order.stockCommittedAt = DateTime.now()
      }
      await order.save()

      return { vuelto: r2(cobrado - total) }
    })

    const datosCuenta = await this.cuenta(business, orderId)
    await this.encolar(null, business, {
      kind: 'nota_venta',
      printerId: null,
      orderId,
      payload: { ...this.ticketBase(business, datosCuenta), cajero: actor.name, vuelto: resultado.vuelto },
    })
    return { ...datosCuenta, vuelto: resultado.vuelto }
  }

  /** Cierra una cuenta sin cobrar (se fueron, error al abrir la mesa…). */
  static async cancelarCuenta(business: Business, actor: Actor, orderId: number, reason: string) {
    this.exigirCaja(actor)
    const motivo = String(reason ?? '').trim().slice(0, 160)
    if (!motivo) throw new OrderError('Escribe el motivo')

    await db.transaction(async (trx) => {
      const order = await Order.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', orderId)
        .andWhere('channel', 'salon')
        .forUpdate()
        .first()
      if (!order) throw new OrderError('Cuenta no encontrada')
      if (order.status !== 'abierta') throw new OrderError('La cuenta ya está cerrada')

      await OrderItem.query({ client: trx })
        .where('order_id', order.id)
        .whereNull('voided_at')
        .update({ voided_at: DateTime.now().toSQL(), void_reason: motivo, voided_by_user_id: actor.userId })

      order.status = 'cancelado'
      order.closedAt = DateTime.now()
      order.note = `Cancelada: ${motivo}`
      order.useTransaction(trx)
      await this.recalcular(order, trx)
    })
    return { ok: true }
  }

  /** Pasa la cuenta a otra mesa libre. */
  static async moverMesa(business: Business, actor: Actor, orderId: number, tableId: number) {
    const destino = await DiningTable.query()
      .where('business_id', business.id)
      .andWhere('id', tableId)
      .andWhere('is_active', true)
      .first()
    if (!destino) throw new OrderError('La mesa no existe')

    const ocupada = await Order.query()
      .where('business_id', business.id)
      .andWhere('dining_table_id', destino.id)
      .andWhere('status', 'abierta')
      .first()
    if (ocupada) throw new OrderError(`La mesa ${destino.name} ya tiene una cuenta abierta`)

    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', orderId)
      .andWhere('status', 'abierta')
      .first()
    if (!order) throw new OrderError('Cuenta no encontrada')

    order.diningTableId = destino.id
    order.tableLabel = destino.name
    order.customerName = `Mesa ${destino.name}`
    await order.save()
    void actor
    return { ok: true }
  }

  // --------------------------------------------------------------- impresión

  private static ticketBase(business: Business, c: Awaited<ReturnType<typeof SalonService.cuenta>>) {
    // Se agrupan las líneas iguales para que el ticket del cliente sea corto.
    const lineas = new Map<string, { cantidad: number; nombre: string; total: number }>()
    for (const i of c.items) {
      if (i.voided) continue
      const nombre = [i.name, ...i.modifiers.map((m) => m.name)].join(' + ')
      const k = `${nombre}|${i.unitPrice}`
      const prev = lineas.get(k)
      lineas.set(k, {
        cantidad: (prev?.cantidad ?? 0) + i.quantity,
        nombre,
        total: r2((prev?.total ?? 0) + i.lineTotal),
      })
    }
    return {
      negocio: business.name,
      direccion: [business.address, business.city].filter(Boolean).join(', ') || null,
      telefono: business.phone ?? business.whatsappPhone ?? null,
      simbolo: business.currencySymbol || 'S/',
      mesa: c.mesa.name,
      cuenta: c.code,
      documento: c.documento,
      lineas: [...lineas.values()],
      subtotal: c.subtotal,
      descuento: c.discountTotal,
      total: c.total,
      pagos: c.payments,
    }
  }

  static async encolar(
    trx: TransactionClientContract | null,
    business: Business,
    datos: { kind: PrintKind; printerId: number | null; orderId: number | null; payload: Record<string, any> }
  ) {
    return PrintJob.create(
      {
        businessId: business.id,
        printerId: datos.printerId,
        orderId: datos.orderId,
        kind: datos.kind,
        payload: { ...datos.payload, hora: DateTime.now().setZone('America/Lima').toFormat('dd/LL HH:mm') },
        status: 'pendiente',
        attempts: 0,
      },
      trx ? { client: trx } : undefined
    )
  }

  private static async nombresDeUsuarios(ids: (number | null)[]) {
    const limpios = [...new Set(ids.filter((v): v is number => !!v))]
    const mapa = new Map<number, string>()
    if (!limpios.length) return mapa
    const staff = await db.from('business_staff').whereIn('user_id', limpios).select('user_id', 'name')
    for (const s of staff) mapa.set(s.user_id, s.name)
    const users = await db.from('users').whereIn('id', limpios).select('id', 'name')
    for (const u of users) if (!mapa.has(u.id)) mapa.set(u.id, u.name)
    return mapa
  }
}
