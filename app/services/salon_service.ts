import type Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import DiningTable from '#models/dining_table'
import Order, { type OrderService as Servicio } from '#models/order'
import OrderItem from '#models/order_item'
import OrderItemModifier from '#models/order_item_modifier'
import OrderRound from '#models/order_round'
import Payment from '#models/payment'
import PrintJob, { type PrintKind } from '#models/print_job'
import Product from '#models/product'
import ProductModifierGroup from '#models/product_modifier_group'
import ProductionArea from '#models/production_area'
import FolioService from '#services/folio_service'
import IngredientService from '#services/ingredient_service'
import OrderService, { OrderError, type LineaMenu } from '#services/order_service'
import PermissionService, { type Actor } from '#services/permission_service'
import type { CobroMostrador } from '#services/pos_service'
import PosSettingsService, { type AjustesPos } from '#services/pos_settings_service'
import PricingService from '#services/pricing_service'
import PromotionService from '#services/promotion_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

export type { Actor }

export interface DatosComanda {
  /** Comedor: la mesa. */
  tableId?: number | null
  /** Cuenta ya abierta (para llevar, delivery o una mesa liberada). */
  orderId?: number | null
  /** Cuenta nueva sin mesa. */
  service?: Servicio | null
  alias?: string | null
  customerName?: string | null
  customerPhone?: string | null
  deliveryAddress?: string | null
  /** Delivery: costo del envío que se suma a la cuenta. */
  shippingCost?: number | null
  /** Generado por el celular: si reintenta sin señal, la ronda no se duplica. */
  clientRequestId: string
  guests?: number | null
  items: LineaMenu[]
}

/** Autorización de un superior que viaja con la petición. */
export interface ConPin {
  pin?: string | null
}

const r2 = PricingService.redondear

const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export const NOMBRE_SERVICIO: Record<Servicio, string> = {
  comedor: 'Comedor',
  para_llevar: 'Para llevar',
  delivery: 'Delivery',
}

/** Qué estilo de ticket usa cada tipo de impresión. */
const ESTILO_DE: Record<PrintKind, keyof AjustesPos['ticket']['tipos']> = {
  comanda: 'comanda',
  anulacion: 'comanda',
  prueba: 'comanda',
  precuenta: 'cuenta',
  nota_venta: 'nota_venta',
  cancelacion: 'cancelacion',
  corte_x: 'corte',
  corte_z: 'corte',
  corte_global: 'corte',
}

/**
 * PDV de salón: cuentas por mesa o sin mesa (para llevar, delivery).
 *
 * La cuenta es un `order` (channel 'salon', status 'abierta'). Mientras está
 * abierta tiene su propio estado (`account_status`): abierta → impresa (con
 * folio) → reabierta → impresa… Al cobrar pasa a 'entregado'. La mesa tiene
 * el suyo: libre, ocupada, cuenta impresa o por liberar.
 */
export default class SalonService {
  // ------------------------------------------------------------- utilidades

  static puedeVer(actor: Actor, order: Order) {
    return actor.permisos['cuentas.ver'] === 'todas' || order.openedByUserId === actor.userId
  }

  private static exigirVisible(actor: Actor, order: Order) {
    if (!this.puedeVer(actor, order)) throw new OrderError('Esta cuenta es de otro mesero')
  }

  private static async cuentaBloqueada(
    business: Business,
    orderId: number,
    trx: TransactionClientContract
  ) {
    const order = await Order.query({ client: trx })
      .where('business_id', business.id)
      .andWhere('id', orderId)
      .andWhere('channel', 'salon')
      .forUpdate()
      .first()
    if (!order) throw new OrderError('Cuenta no encontrada')
    return order
  }

  private static exigirAbierta(order: Order) {
    if (order.status !== 'abierta') throw new OrderError('La cuenta ya está cerrada')
  }

  private static exigirEditable(order: Order) {
    this.exigirAbierta(order)
    if (order.accountStatus === 'impresa') {
      throw new OrderError('La cuenta ya se imprimió. Reábrela para modificarla.')
    }
  }

  /** Cómo se nombra la cuenta en pantalla y en los tickets: "Mesa 4 · M003", "L007 · Juan". */
  /**
   * El nombre de la cuenta: si tiene mesa, el de la mesa ("Mesa 4"); si no,
   * su número del día (M001, L005, D001). El cliente va aparte.
   */
  static etiqueta(order: Order) {
    if (order.diningTableId) return `Mesa ${order.tableLabel ?? ''}`.trim()
    return order.accountName || order.tableLabel || order.customerName
  }

  /** Cliente de la cuenta, si se le asignó uno (o se escribió su nombre). */
  static cliente(order: Order) {
    if (order.customerId) return order.customerName
    if (order.service === 'comedor') return null
    const n = order.customerName?.trim()
    return n && n !== order.accountName && !/^Mesa /.test(n) ? n : null
  }

  // ---------------------------------------------------------------- lectura

  /** Mesas con su estado y la cuenta que tienen (si el actor puede verla). */
  static async mesas(business: Business, actor: Actor) {
    const mesas = await DiningTable.query()
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')

    const abiertas = await Order.query()
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('status', 'abierta')
      .whereNotNull('dining_table_id')
      .withCount('items', (q) => q.whereNull('voided_at'))
      .withCount('items', (q) =>
        q.whereNull('voided_at').andWhere('kitchen_status', 'listo').as('listos')
      )

    const nombres = await this.nombresDeUsuarios(abiertas.map((o) => o.openedByUserId))
    const porMesa = new Map(abiertas.map((o) => [o.diningTableId, o]))

    return mesas.map((m) => {
      const o = porMesa.get(m.id)
      const estado = o
        ? o.accountStatus === 'impresa'
          ? 'impresa'
          : 'ocupada'
        : m.needsRelease
          ? 'por_liberar'
          : 'libre'
      return {
        id: m.id,
        name: m.name,
        zone: m.zone,
        seats: m.seats,
        estado,
        cuenta: o ? this.resumenCuenta(o, actor, nombres) : null,
      }
    })
  }

  private static resumenCuenta(o: Order, actor: Actor, nombres: Map<number, string>) {
    const visible = this.puedeVer(actor, o)
    return {
      id: o.id,
      propia: o.openedByUserId === actor.userId,
      visible,
      mesero: o.openedByUserId ? (nombres.get(o.openedByUserId) ?? null) : null,
      service: o.service,
      etiqueta: this.etiqueta(o),
      cliente: this.cliente(o),
      telefono: o.customerPhone,
      accountStatus: o.accountStatus,
      folio: FolioService.texto(o.folioSeries, o.folioNumber),
      total: visible ? Number(o.total) : null,
      guests: o.guests,
      items: Number(o.$extras.items_count ?? 0),
      /** Platos que cocina ya terminó y faltan llevar a la mesa. */
      listos: Number(o.$extras.listos ?? 0),
      abiertaDesde: o.createdAt.toISO(),
      mesa: o.diningTableId ? o.tableLabel : null,
      mesaId: o.diningTableId,
    }
  }

  /**
   * Cuentas de servicio con búsqueda por folio, nombre, mesa, teléfono o
   * mesero. Con `cerradas`, las de las últimas 24 h ya cobradas o canceladas.
   */
  static async cuentas(
    business: Business,
    actor: Actor,
    filtros: { q?: string; cerradas?: boolean } = {}
  ) {
    const q = Order.query()
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .withCount('items', (i) => i.whereNull('voided_at'))
      .withCount('items', (i) =>
        i.whereNull('voided_at').andWhere('kitchen_status', 'listo').as('listos')
      )
      .orderBy('id', 'desc')
      .limit(100)

    if (filtros.cerradas) {
      q.whereIn('status', ['entregado', 'cancelado']).andWhere(
        'closed_at',
        '>=',
        DateTime.now().minus({ hours: 24 }).toSQL()!
      )
    } else {
      q.where('status', 'abierta')
    }
    if (actor.permisos['cuentas.ver'] !== 'todas') q.andWhere('opened_by_user_id', actor.userId)

    const texto = String(filtros.q ?? '').trim()
    if (texto) {
      const num = Number(texto.replace(/\D/g, ''))
      // Sin tildes: "perez" encuentra a "Pérez".
      const plano = sinTildes(texto).toLowerCase()
      const col = (c: string) =>
        db.raw(`translate(lower(${c}), 'áéíóúüñ', 'aeiouun') like ?`, [`%${plano}%`])
      q.where((w) => {
        w.whereRaw(col('table_label'))
          .orWhereRaw(col('customer_name'))
          .orWhereRaw(col("coalesce(account_name, '')"))
          .orWhereILike('code', `%${texto}%`)
          .orWhereILike('customer_phone', `%${texto}%`)
        if (num) w.orWhere('folio_number', num)
        w.orWhereIn(
          'opened_by_user_id',
          db
            .from('business_staff')
            .where('business_id', business.id)
            .whereILike('name', `%${texto}%`)
            .select('user_id')
        )
      })
    }

    const lista = await q
    const nombres = await this.nombresDeUsuarios(lista.map((o) => o.openedByUserId))
    return lista.map((o) => ({ ...this.resumenCuenta(o, actor, nombres), status: o.status }))
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
        g
          .where('is_active', true)
          .preload('options', (o) => o.where('is_active', true).orderBy('sort_order', 'asc'))
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
        options: r.group.options.map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: Number(o.priceDelta),
        })),
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

  /** La cuenta completa, con rondas, anulados y pagos. `actor` null = uso interno. */
  static async cuenta(business: Business, actor: Actor | null, orderId: number) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', orderId)
      .andWhere('channel', 'salon')
      .preload('items', (q) => q.preload('modifiers').orderBy('id', 'asc'))
      .preload('payments')
      .first()
    if (!order) throw new OrderError('Cuenta no encontrada')
    if (actor) this.exigirVisible(actor, order)

    const rondas = await OrderRound.query().where('order_id', order.id).orderBy('number', 'asc')
    const nombres = await this.nombresDeUsuarios([
      order.openedByUserId,
      ...order.payments.map((p) => p.userId),
    ])

    return {
      id: order.id,
      code: order.code,
      status: order.status,
      accountStatus: order.accountStatus,
      service: order.service,
      etiqueta: this.etiqueta(order),
      mesa: { id: order.diningTableId, name: order.diningTableId ? order.tableLabel : null },
      accountName: order.accountName,
      cliente: this.cliente(order),
      customerId: order.customerId,
      shippingCost: Number(order.shippingCost ?? 0),
      courier: order.courier,
      shippedAt: order.shippedAt?.toISO() ?? null,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      guests: order.guests,
      mesero: order.openedByUserId ? (nombres.get(order.openedByUserId) ?? null) : null,
      propia: actor ? order.openedByUserId === actor.userId : false,
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      discountReason: order.discountReason,
      total: Number(order.total),
      paidTotal: Number(order.paidTotal),
      folio: FolioService.texto(order.folioSeries, order.folioNumber),
      documento: FolioService.texto(order.folioSeries, order.folioNumber),
      printCount: order.printCount,
      reopenCount: order.reopenCount,
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
        courtesy: i.isCourtesy,
        courtesyReason: i.isCourtesy ? i.promotionName : null,
        kitchenStatus: i.kitchenStatus,
      })),
      payments: order.payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        cobradoPor: p.userId ? (nombres.get(p.userId) ?? null) : null,
      })),
    }
  }

  // --------------------------------------------------------------- comandar

  /**
   * Envía una ronda. Abre la cuenta si hace falta: en la mesa (comedor) o
   * sin mesa (para llevar / delivery). Es idempotente por `clientRequestId`.
   */
  static async comandar(business: Business, actor: Actor, datos: DatosComanda) {
    const requestId = String(datos.clientRequestId ?? '')
      .trim()
      .slice(0, 64)
    if (!requestId) throw new OrderError('Falta el identificador de la comanda')

    const repetida = await OrderRound.query()
      .where('business_id', business.id)
      .andWhere('client_request_id', requestId)
      .first()
    if (repetida) return { orderId: repetida.orderId, roundId: repetida.id, repetida: true }

    const ajustes = await PosSettingsService.leer(business)

    let mesa: DiningTable | null = null
    let servicio: Servicio = 'comedor'
    if (datos.orderId) {
      // Ronda sobre una cuenta que ya existe: se valida dentro de la transacción.
    } else if (datos.tableId) {
      if (!ajustes.servicios.comedor) throw new OrderError('El servicio de comedor está apagado')
      mesa = await DiningTable.query()
        .where('business_id', business.id)
        .andWhere('id', Number(datos.tableId))
        .andWhere('is_active', true)
        .first()
      if (!mesa) throw new OrderError('La mesa no existe')
    } else {
      servicio =
        datos.service === 'delivery'
          ? 'delivery'
          : datos.service === 'comedor'
            ? 'comedor'
            : 'para_llevar'
      if (!ajustes.servicios[servicio])
        throw new OrderError(`El servicio ${NOMBRE_SERVICIO[servicio]} está apagado`)
      // Comedor sin mesa (M001) lo abre cualquiera; para llevar y delivery según permiso.
      if (servicio !== 'comedor')
        await PermissionService.exigir(business, actor, 'cuentas.abrir_sin_mesa')
      if (servicio === 'delivery') {
        if (!datos.customerName?.trim()) throw new OrderError('Falta el nombre del cliente')
        if (!datos.customerPhone?.trim()) throw new OrderError('Falta el teléfono del cliente')
        if (!datos.deliveryAddress?.trim()) throw new OrderError('Falta la dirección de entrega')
      }
    }

    // Validación y precios fuera de la transacción: no escribe nada.
    const { lineas } = await OrderService.prepararLineasMenu(business, datos.items, null)
    const areas = await this.areasDe(
      business,
      lineas.map((l) => l.producto)
    )

    const ejecutar = () =>
      db.transaction(async (trx) => {
        let order: Order | null = null

        if (datos.orderId) {
          order = await this.cuentaBloqueada(business, Number(datos.orderId), trx)
          this.exigirVisible(actor, order)
          this.exigirEditable(order)
        } else if (mesa) {
          order = await Order.query({ client: trx })
            .where('business_id', business.id)
            .andWhere('dining_table_id', mesa.id)
            .andWhere('status', 'abierta')
            .forUpdate()
            .first()
          if (order) {
            this.exigirVisible(actor, order)
            this.exigirEditable(order)
          } else {
            const fresca = await DiningTable.query({ client: trx })
              .where('id', mesa.id)
              .forUpdate()
              .firstOrFail()
            if (fresca.needsRelease) throw new OrderError(`La mesa ${mesa.name} está por liberar`)
          }
        }

        if (!order) {
          const numero = await this.siguienteNombre(business, servicio, trx)
          const alias = mesa
            ? mesa.name
            : datos.alias?.trim().slice(0, 60) || datos.customerName?.trim().slice(0, 60) || numero
          // Delivery: el cliente queda guardado para la próxima vez (se busca por teléfono).
          const cliente =
            servicio === 'delivery'
              ? await OrderService.registrarCliente(
                  business,
                  {
                    customerName: datos.customerName!.trim(),
                    customerPhone: datos.customerPhone!.trim(),
                    deliveryAddress: datos.deliveryAddress?.trim() || null,
                    items: [],
                  },
                  trx
                )
              : null
          order = await Order.create(
            {
              businessId: business.id,
              code: await OrderService.siguienteCodigo(business, trx),
              channel: 'salon',
              service: servicio,
              status: 'abierta',
              accountStatus: 'abierta',
              customerName: mesa ? `Mesa ${mesa.name}` : datos.customerName?.trim() || alias,
              customerPhone: cliente?.phone ?? (datos.customerPhone?.trim() || null),
              customerId: cliente?.id ?? null,
              accountName: numero,
              deliveryMethod:
                servicio === 'delivery' ? 'envio' : servicio === 'comedor' ? 'mesa' : 'recojo',
              deliveryAddress: datos.deliveryAddress?.trim() || null,
              tableLabel: alias,
              diningTableId: mesa?.id ?? null,
              guests: datos.guests ? Math.max(1, Math.floor(Number(datos.guests))) : null,
              openedByUserId: actor.userId,
              currency: business.currency,
              subtotal: 0,
              discountTotal: 0,
              shippingCost:
                servicio === 'delivery' ? r2(Math.max(0, Number(datos.shippingCost ?? 0) || 0)) : 0,
              total: 0,
              paidTotal: 0,
            },
            { client: trx }
          )
        }

        const anteriores = await OrderRound.query({ client: trx })
          .where('order_id', order.id)
          .count('* as n')
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

        const creados: OrderItem[] = []
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
              kitchenStatus: 'pendiente',
              sentToKitchenAt: DateTime.now(),
            },
            { client: trx }
          )
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
          }
          await item.load('modifiers')
          creados.push(item)
        }

        order.subtotal = r2(Number(order.subtotal) + bruto)
        order.useTransaction(trx)
        await this.recalcular(order, trx)

        await this.imprimirComandas(trx, business, order, ronda, creados, actor.name, areas)
        return { orderId: order.id, roundId: ronda.id, repetida: false }
      })

    try {
      return await ejecutar()
    } catch (error: any) {
      // Dos personas abrieron la misma mesa a la vez, o el reintento llegó
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

  /** Un ticket por área. Lo que no tiene área sale por la impresora de caja. */
  static async imprimirComandas(
    trx: TransactionClientContract | null,
    business: Business,
    order: Order,
    ronda: OrderRound | null,
    items: OrderItem[],
    mesero: string,
    areas?: Map<number, ProductionArea | null>,
    reimpresion = false
  ) {
    const porArea = new Map<number | null, OrderItem[]>()
    for (const i of items) {
      const k = i.productionAreaId ?? null
      porArea.set(k, [...(porArea.get(k) ?? []), i])
    }
    const todas = areas
      ? [...areas.values()]
      : await ProductionArea.query(trx ? { client: trx } : {}).where('business_id', business.id)
    for (const [areaId, lista] of porArea) {
      const area = areaId ? (todas.find((a) => a?.id === areaId) ?? null) : null
      await this.encolar(trx, business, {
        kind: 'comanda',
        printerId: area?.printerId ?? null,
        orderId: order.id,
        payload: {
          area: area?.name ?? lista[0].productionAreaName ?? 'General',
          servicio: order.service,
          mesa: this.etiqueta(order),
          mesero,
          ronda: ronda?.number ?? null,
          cuenta: order.code,
          reimpresion,
          cliente: order.service === 'delivery' ? order.customerName : null,
          items: lista.map((i) => ({
            cantidad: i.quantity,
            nombre: i.productName,
            opciones: (i.modifiers ?? []).map((m) =>
              m.quantity > 1 ? `${m.quantity}x ${m.optionName}` : m.optionName
            ),
            nota: i.note,
          })),
        },
      })
    }
  }

  /**
   * Número de cuenta del día por servicio: M001 (comedor), L001 (para
   * llevar), D001 (delivery). Un candado por negocio y servicio evita que dos
   * cajas saquen el mismo número a la vez.
   */
  private static async siguienteNombre(
    business: Business,
    servicio: Servicio,
    trx: TransactionClientContract
  ) {
    const prefijo = servicio === 'comedor' ? 'M' : servicio === 'delivery' ? 'D' : 'L'
    await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [business.id, prefijo.charCodeAt(0)])
    const inicio = DateTime.now().setZone('America/Lima').startOf('day').toUTC().toSQL()!
    const fila = await trx
      .from('orders')
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('service', servicio)
      .andWhere('created_at', '>=', inicio)
      .count('* as n')
      .first()
    return `${prefijo}${String(Number(fila?.n ?? 0) + 1).padStart(3, '0')}`
  }

  /** Área de cada plato: la suya, o la de su primera categoría que tenga una. */
  static async areasDe(business: Business, productos: Product[]) {
    const areas = await ProductionArea.query()
      .where('business_id', business.id)
      .andWhere('is_active', true)
    const areaPorId = new Map(areas.map((a) => [a.id, a]))
    const resultado = new Map<number, ProductionArea | null>()

    const sinPropia = productos.filter(
      (p) => !p.productionAreaId || !areaPorId.has(p.productionAreaId)
    )
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
        if (a && areaPorId.has(a) && !porCategoria.has(l.productId))
          porCategoria.set(l.productId, a)
      }
    }
    for (const p of productos) {
      const id =
        p.productionAreaId && areaPorId.has(p.productionAreaId)
          ? p.productionAreaId
          : porCategoria.get(p.id)
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
    const platos = r2(Number(fila?.total ?? 0))
    order.subtotal = r2(Math.max(Number(order.subtotal), platos))
    order.discountTotal = r2(Number(order.subtotal) - platos)
    // El envío del delivery va aparte y se suma al total.
    order.total = r2(platos + Number(order.shippingCost ?? 0))
    order.useTransaction(trx)
    await order.save()
  }

  private static async tieneItems(order: Order, trx: TransactionClientContract) {
    const f = await trx
      .from('order_items')
      .where('order_id', order.id)
      .whereNull('voided_at')
      .count('* as n')
      .first()
    return Number(f?.n ?? 0) > 0
  }

  // ------------------------------------------------------ imprimir / reabrir

  /**
   * Imprime la cuenta. La primera vez asigna folio (serie de la caja del
   * equipo, o la serie por defecto) y la cuenta queda "impresa": ya no se le
   * agrega nada sin reabrirla. Reimprimir conserva el folio.
   */
  static async imprimirCuenta(
    business: Business,
    actor: Actor,
    orderId: number,
    opciones: ConPin = {}
  ) {
    await PermissionService.exigir(business, actor, 'cuentas.imprimir', {
      pin: opciones.pin,
      contexto: `Imprimir cuenta ${orderId}`,
    })
    const cajaId = await this.cajaDelActor(business, actor)

    await db.transaction(async (trx) => {
      const order = await this.cuentaBloqueada(business, orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirAbierta(order)
      if (!(await this.tieneItems(order, trx))) throw new OrderError('La cuenta está vacía')
      await FolioService.asignar(business, order, cajaId, trx)
      order.accountStatus = 'impresa'
      order.printCount = (order.printCount ?? 0) + 1
      order.printedAt = DateTime.now()
      order.useTransaction(trx)
      await order.save()
    })

    const datos = await this.cuenta(business, null, orderId)
    await this.encolar(null, business, {
      kind: 'precuenta',
      printerId: null,
      orderId,
      payload: {
        ...this.ticketBase(business, datos),
        mesero: datos.mesero,
        pedidoPor: actor.name,
        copia: datos.printCount > 1,
      },
    })
    return datos
  }

  /** Reabre una cuenta impresa para agregar o quitar. El folio no cambia. */
  static async reabrir(business: Business, actor: Actor, orderId: number, opciones: ConPin = {}) {
    const autorizo = await PermissionService.exigir(business, actor, 'cuentas.reabrir', {
      pin: opciones.pin,
      contexto: `Reabrir cuenta ${orderId}`,
    })
    await db.transaction(async (trx) => {
      const order = await this.cuentaBloqueada(business, orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirAbierta(order)
      if (order.accountStatus !== 'impresa') throw new OrderError('La cuenta no está impresa')
      order.accountStatus = 'reabierta'
      order.reopenCount = (order.reopenCount ?? 0) + 1
      order.useTransaction(trx)
      await order.save()
    })
    return { ok: true, autorizo }
  }

  // ---------------------------------------------------------------- anular

  /** Anula un plato ya comandado (o parte: 1 de 3). Sale aviso a su área. */
  static async anularItem(
    business: Business,
    actor: Actor,
    itemId: number,
    datos: { reason: string; quantity?: number } & ConPin
  ) {
    const motivo = String(datos.reason ?? '')
      .trim()
      .slice(0, 160)
    if (!motivo) throw new OrderError('Escribe el motivo de la anulación')
    const autorizo = await PermissionService.exigir(business, actor, 'cuentas.anular_plato', {
      pin: datos.pin,
      contexto: `Anular plato ${itemId}: ${motivo}`,
    })

    return db.transaction(async (trx) => {
      const item = await OrderItem.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', itemId)
        .preload('modifiers')
        .forUpdate()
        .first()
      if (!item) throw new OrderError('Plato no encontrado')
      if (item.voidedAt) throw new OrderError('Ese plato ya está anulado')

      const order = await this.cuentaBloqueada(business, item.orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirEditable(order)

      const cantidad = Math.floor(Number(datos.quantity ?? item.quantity))
      if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > item.quantity) {
        throw new OrderError(`Puedes anular entre 1 y ${item.quantity}`)
      }

      const anulado = await this.partir(item, cantidad, trx)
      anulado.voidedAt = DateTime.now()
      anulado.voidReason = (autorizo ? `${motivo} (autorizó ${autorizo})` : motivo).slice(0, 160)
      anulado.voidedByUserId = actor.userId
      anulado.useTransaction(trx)
      await anulado.save()

      // Lo anulado sale también del subtotal; si no, se vería como descuento.
      const pct = Number(anulado.discountPercentage ?? 0)
      const brutoAnulado =
        pct > 0 && pct < 100
          ? Number(anulado.lineTotal) / (1 - pct / 100)
          : Number(anulado.lineTotal)
      order.subtotal = r2(Math.max(0, Number(order.subtotal) - brutoAnulado))
      await this.recalcular(order, trx)

      const area = anulado.productionAreaId
        ? await ProductionArea.find(anulado.productionAreaId, { client: trx })
        : null
      await this.encolar(trx, business, {
        kind: 'anulacion',
        printerId: area?.printerId ?? null,
        orderId: order.id,
        payload: {
          area: anulado.productionAreaName ?? 'General',
          servicio: order.service,
          mesa: this.etiqueta(order),
          mesero: actor.name,
          cuenta: order.code,
          motivo: anulado.voidReason,
          items: [{ cantidad, nombre: anulado.productName, opciones: [], nota: null }],
        },
      })
      return { orderId: order.id }
    })
  }

  /** Separa `cantidad` unidades de una línea en una línea nueva (para anular o regalar una parte). */
  private static async partir(item: OrderItem, cantidad: number, trx: TransactionClientContract) {
    if (cantidad >= item.quantity) return item
    const unit = Number(item.lineTotal) / item.quantity
    const nueva = await OrderItem.create(
      {
        ...item.$attributes,
        id: undefined,
        quantity: cantidad,
        lineTotal: r2(unit * cantidad),
      } as any,
      { client: trx }
    )
    for (const m of item.modifiers ?? []) {
      await OrderItemModifier.create(
        { ...m.$attributes, id: undefined, orderItemId: nueva.id } as any,
        {
          client: trx,
        }
      )
    }
    item.quantity -= cantidad
    item.lineTotal = r2(Number(item.lineTotal) - Number(nueva.lineTotal))
    item.useTransaction(trx)
    await item.save()
    return nueva
  }

  /** Cortesía: el plato (o parte) queda en la cuenta a S/ 0, con motivo y quién la dio. */
  static async cortesia(
    business: Business,
    actor: Actor,
    itemId: number,
    datos: { reason: string; quantity?: number } & ConPin
  ) {
    const motivo = String(datos.reason ?? '')
      .trim()
      .slice(0, 160)
    if (!motivo) throw new OrderError('Escribe el motivo de la cortesía')
    const autorizo = await PermissionService.exigir(business, actor, 'cobro.cortesia', {
      pin: datos.pin,
      contexto: `Cortesía plato ${itemId}: ${motivo}`,
    })
    return db.transaction(async (trx) => {
      const item = await OrderItem.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', itemId)
        .preload('modifiers')
        .forUpdate()
        .first()
      if (!item || item.voidedAt) throw new OrderError('Plato no encontrado')
      if (item.isCourtesy) throw new OrderError('Ese plato ya es cortesía')
      const order = await this.cuentaBloqueada(business, item.orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirEditable(order)
      const cantidad = Math.min(
        item.quantity,
        Math.max(1, Math.floor(Number(datos.quantity ?? item.quantity)))
      )
      const regalo = await this.partir(item, cantidad, trx)
      regalo.isCourtesy = true
      regalo.unitPrice = 0
      regalo.lineTotal = 0
      regalo.discountPercentage = 100
      regalo.promotionName =
        `Cortesía: ${motivo} (${autorizo ? `autorizó ${autorizo}` : actor.name})`.slice(0, 255)
      regalo.useTransaction(trx)
      await regalo.save()
      await this.recalcular(order, trx)
      return { orderId: order.id }
    })
  }

  // ------------------------------------------------------------------ cobro

  /** Caja a la que cobra el actor: la del equipo, la suya abierta o la única abierta. */
  static async cajaDelActor(business: Business, actor: Actor): Promise<number | null> {
    if (actor.cashRegisterId) return actor.cashRegisterId
    const abiertas = await db
      .from('cash_sessions')
      .where('business_id', business.id)
      .andWhere('status', 'abierta')
      .select('cash_register_id', 'user_id')
    return (
      abiertas.find((s) => s.user_id === actor.userId)?.cash_register_id ??
      (abiertas.length === 1 ? abiertas[0].cash_register_id : null)
    )
  }

  private static async sesionParaCobrar(
    business: Business,
    actor: Actor,
    trx: TransactionClientContract
  ) {
    const abiertas = await trx
      .from('cash_sessions')
      .where('business_id', business.id)
      .andWhere('status', 'abierta')
      .select('id', 'user_id', 'cash_register_id')
    if (actor.cashRegisterId) {
      const s = abiertas.find((x) => x.cash_register_id === actor.cashRegisterId)
      if (s) return s
      throw new OrderError('La caja de este equipo está cerrada. Ábrela para cobrar.')
    }
    const s =
      abiertas.find((x) => x.user_id === actor.userId) ??
      (abiertas.length === 1 ? abiertas[0] : null)
    if (!s) {
      throw new OrderError(
        abiertas.length
          ? 'Hay varias cajas abiertas: asigna una caja a este equipo en Infraestructura → Equipos'
          : 'No hay caja abierta. Abre la caja antes de cobrar.'
      )
    }
    return s
  }

  /**
   * Cobra y cierra la cuenta: registra los pagos en la caja que corresponde,
   * asigna folio si no tenía, descuenta insumos e imprime la nota de venta.
   * El mesero puede cobrar si su rol lo permite o si alguien lo autoriza; lo
   * que cobre lo declara después en caja.
   */
  static async cobrar(
    business: Business,
    actor: Actor,
    orderId: number,
    datos: {
      payments: CobroMostrador[]
      discountPercentage?: number
      discountReason?: string | null
      customerName?: string | null
    } & ConPin
  ) {
    await PermissionService.exigir(business, actor, 'cobro.cobrar', {
      pin: datos.pin,
      contexto: `Cobrar cuenta ${orderId}`,
    })
    const pct = Math.min(Math.max(Number(datos.discountPercentage ?? 0), 0), 100)
    let autorizoDescuento: string | null = null
    if (pct > 0) {
      if (!String(datos.discountReason ?? '').trim())
        throw new OrderError('Escribe el motivo del descuento')
      autorizoDescuento = await PermissionService.exigir(business, actor, 'cobro.descuento', {
        pin: datos.pin,
        valor: pct,
        contexto: `Descuento ${pct}% cuenta ${orderId}`,
      })
    }
    const ajustes = await PosSettingsService.leer(business)

    const resultado = await db.transaction(async (trx) => {
      const order = await this.cuentaBloqueada(business, orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirAbierta(order)

      await this.recalcular(order, trx)
      if (!(await this.tieneItems(order, trx)))
        throw new OrderError('La cuenta no tiene nada que cobrar')

      const sesion = await this.sesionParaCobrar(business, actor, trx)

      // El descuento es sobre los platos, no sobre el envío.
      const rebaja = r2(((Number(order.total) - Number(order.shippingCost ?? 0)) * pct) / 100)
      const total = r2(Number(order.total) - rebaja)
      const cobrado = r2((datos.payments ?? []).reduce((t, p) => t + Number(p.amount || 0), 0))
      if (cobrado < total - 0.009) {
        throw new OrderError(
          `Falta cobrar: el total es ${total.toFixed(2)} y se registraron ${cobrado.toFixed(2)}`
        )
      }

      // Lo que se recibe de más es vuelto, no pago.
      let restante = total
      for (const pago of datos.payments ?? []) {
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
            cashSessionId: sesion.id,
          },
          { client: trx }
        )
      }

      await FolioService.asignar(business, order, sesion.cash_register_id, trx)
      order.discountTotal = r2(Number(order.discountTotal) + rebaja)
      if (pct > 0) {
        order.discountReason =
          `${pct}%: ${String(datos.discountReason).trim()}${autorizoDescuento ? ` (autorizó ${autorizoDescuento})` : ''}`.slice(
            0,
            160
          )
      }
      order.total = total
      order.paidTotal = total
      order.status = 'entregado'
      order.accountStatus = null
      order.closedAt = DateTime.now()
      order.deliveredAt = DateTime.now()
      if (datos.customerName?.trim()) order.customerName = datos.customerName.trim().slice(0, 120)

      if (business.esRestaurante && !order.stockCommittedAt) {
        await IngredientService.consumirPedido(order, trx, actor.userId)
        order.stockCommittedAt = DateTime.now()
      }
      order.useTransaction(trx)
      await order.save()

      // La mesa: libre al cobrar, o "por liberar" si el negocio libera a mano.
      if (order.diningTableId) {
        await trx
          .from('dining_tables')
          .where('id', order.diningTableId)
          .update({ needs_release: ajustes.liberarMesaManual })
      }

      return { vuelto: r2(cobrado - total) }
    })

    const datosCuenta = await this.cuenta(business, null, orderId)
    await this.encolar(null, business, {
      kind: 'nota_venta',
      printerId: null,
      orderId,
      payload: {
        ...this.ticketBase(business, datosCuenta),
        mesero: datosCuenta.mesero,
        cajero: actor.name,
        vuelto: resultado.vuelto,
      },
    })
    return { ...datosCuenta, vuelto: resultado.vuelto }
  }

  /** Reimprime la nota de venta de una cuenta cobrada. */
  static async reimprimirNota(
    business: Business,
    actor: Actor,
    orderId: number,
    opciones: ConPin = {}
  ) {
    await PermissionService.exigir(business, actor, 'cobro.cobrar', {
      pin: opciones.pin,
      contexto: `Reimprimir nota de venta ${orderId}`,
    })
    const datos = await this.cuenta(business, actor, orderId)
    if (datos.status !== 'entregado') throw new OrderError('La cuenta aún no se cobra')
    await this.encolar(null, business, {
      kind: 'nota_venta',
      printerId: null,
      orderId,
      payload: {
        ...this.ticketBase(business, datos),
        mesero: datos.mesero,
        cajero: actor.name,
        copia: true,
      },
    })
    return { ok: true }
  }

  /** Reimprime la comanda de una ronda (por ejemplo, si la impresora falló). */
  static async reimprimirComanda(
    business: Business,
    actor: Actor,
    roundId: number,
    opciones: ConPin = {}
  ) {
    await PermissionService.exigir(business, actor, 'cuentas.reimprimir_comanda', {
      pin: opciones.pin,
    })
    const ronda = await OrderRound.query()
      .where('business_id', business.id)
      .andWhere('id', roundId)
      .first()
    if (!ronda) throw new OrderError('Ronda no encontrada')
    const order = await Order.findOrFail(ronda.orderId)
    this.exigirVisible(actor, order)
    const items = await OrderItem.query()
      .where('order_round_id', ronda.id)
      .whereNull('voided_at')
      .preload('modifiers')
    if (!items.length) throw new OrderError('Esa ronda no tiene platos vigentes')
    await this.imprimirComandas(
      null,
      business,
      order,
      ronda,
      items,
      ronda.userName ?? actor.name,
      undefined,
      true
    )
    return { ok: true }
  }

  /** Cierra una cuenta sin cobrar. Avisa a cada área y deja comprobante en caja. */
  static async cancelarCuenta(
    business: Business,
    actor: Actor,
    orderId: number,
    reason: string,
    opciones: ConPin = {}
  ) {
    const motivo = String(reason ?? '')
      .trim()
      .slice(0, 160)
    if (!motivo) throw new OrderError('Escribe el motivo')
    const autorizo = await PermissionService.exigir(business, actor, 'cuentas.cancelar', {
      pin: opciones.pin,
      contexto: `Cancelar cuenta ${orderId}: ${motivo}`,
    })
    const motivoFinal = (autorizo ? `${motivo} (autorizó ${autorizo})` : motivo).slice(0, 160)

    await db.transaction(async (trx) => {
      const order = await this.cuentaBloqueada(business, orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirAbierta(order)

      const vigentes = await OrderItem.query({ client: trx })
        .where('order_id', order.id)
        .whereNull('voided_at')
        .preload('modifiers')

      // Cada área se entera de lo que ya no debe preparar.
      const porArea = new Map<number | null, OrderItem[]>()
      for (const i of vigentes)
        porArea.set(i.productionAreaId, [...(porArea.get(i.productionAreaId) ?? []), i])
      for (const [areaId, lista] of porArea) {
        const area = areaId ? await ProductionArea.find(areaId, { client: trx }) : null
        await this.encolar(trx, business, {
          kind: 'anulacion',
          printerId: area?.printerId ?? null,
          orderId: order.id,
          payload: {
            area: lista[0].productionAreaName ?? 'General',
            servicio: order.service,
            mesa: this.etiqueta(order),
            mesero: actor.name,
            cuenta: order.code,
            motivo: `CUENTA CANCELADA: ${motivoFinal}`,
            items: lista.map((i) => ({
              cantidad: i.quantity,
              nombre: i.productName,
              opciones: [],
              nota: null,
            })),
          },
        })
      }
      // Y caja queda con el comprobante de la cancelación.
      await this.encolar(trx, business, {
        kind: 'cancelacion',
        printerId: null,
        orderId: order.id,
        payload: {
          negocio: business.name,
          simbolo: business.currencySymbol || 'S/',
          mesa: this.etiqueta(order),
          cuenta: order.code,
          folio: FolioService.texto(order.folioSeries, order.folioNumber),
          canceladoPor: actor.name,
          motivo: motivoFinal,
          total: Number(order.total),
          lineas: vigentes.map((i) => ({
            cantidad: i.quantity,
            nombre: i.productName,
            total: Number(i.lineTotal),
          })),
        },
      })

      await OrderItem.query({ client: trx })
        .where('order_id', order.id)
        .whereNull('voided_at')
        .update({
          voided_at: DateTime.now().toSQL(),
          void_reason: motivoFinal,
          voided_by_user_id: actor.userId,
        })

      order.status = 'cancelado'
      order.accountStatus = null
      order.closedAt = DateTime.now()
      order.note = `Cancelada: ${motivoFinal}`
      order.subtotal = 0
      await this.recalcular(order, trx)
    })
    return { ok: true }
  }

  // ------------------------------------------------- para llevar y delivery

  /**
   * Pedidos para llevar o delivery del día que aún no se entregan: los
   * abiertos y también los ya cobrados (en caja se cobra primero y se entrega
   * cuando cocina termina). Con el avance de cocina de cada uno.
   */
  static async enCurso(business: Business, actor: Actor, servicio: 'para_llevar' | 'delivery') {
    const inicio = DateTime.now().minus({ hours: 18 }).toSQL()!
    const q = Order.query()
      .where('business_id', business.id)
      .andWhere('channel', 'salon')
      .andWhere('service', servicio)
      .andWhere('created_at', '>=', inicio)
      .where((w) => {
        w.where('status', 'abierta').orWhere((p) =>
          p
            .where('status', 'entregado')
            .whereExists((e) =>
              e
                .from('order_items')
                .whereColumn('order_items.order_id', 'orders.id')
                .whereNull('order_items.voided_at')
                .whereIn('order_items.kitchen_status', ['pendiente', 'preparando', 'listo'])
            )
        )
      })
      .withCount('items', (i) =>
        i.whereNull('voided_at').whereNotNull('kitchen_status').as('enCocina')
      )
      .withCount('items', (i) =>
        i.whereNull('voided_at').whereIn('kitchen_status', ['listo', 'servido']).as('terminados')
      )
      .orderBy('id', 'asc')
    if (actor.permisos['cuentas.ver'] !== 'todas') q.andWhere('opened_by_user_id', actor.userId)
    const lista = await q
    return lista.map((o) => {
      const total = Number(o.$extras.enCocina ?? 0)
      const listos = Number(o.$extras.terminados ?? 0)
      return {
        id: o.id,
        etiqueta: this.etiqueta(o),
        accountName: o.accountName,
        cliente: this.cliente(o),
        telefono: o.customerPhone,
        direccion: o.deliveryAddress,
        total: Number(o.total),
        pagado: o.status === 'entregado',
        folio: FolioService.texto(o.folioSeries, o.folioNumber),
        cocina:
          total === 0
            ? 'sin_cocina'
            : listos >= total
              ? 'listo'
              : listos > 0
                ? 'parcial'
                : 'en_cocina',
        platos: total,
        listos,
        courier: o.courier,
        salioEn: o.shippedAt?.toISO() ?? null,
        desde: o.createdAt.toISO(),
      }
    })
  }

  /** Delivery: salió con el repartidor. */
  static async despachar(
    business: Business,
    actor: Actor,
    orderId: number,
    courier?: string | null
  ) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', orderId)
      .andWhere('channel', 'salon')
      .first()
    if (!order) throw new OrderError('Pedido no encontrado')
    this.exigirVisible(actor, order)
    order.shippedAt = DateTime.now()
    if (courier?.trim()) order.courier = courier.trim().slice(0, 60)
    await order.save()
    return { ok: true }
  }

  /** Se entregó al cliente: todo lo de cocina queda como servido. */
  static async entregar(business: Business, actor: Actor, orderId: number) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', orderId)
      .first()
    if (!order) throw new OrderError('Pedido no encontrado')
    this.exigirVisible(actor, order)
    await OrderItem.query()
      .where('order_id', order.id)
      .whereNull('voided_at')
      .whereIn('kitchen_status', ['pendiente', 'preparando', 'listo'])
      .update({ kitchen_status: 'servido', served_at: DateTime.now().toSQL() })
    return { ok: true }
  }

  /** Clientes por teléfono o nombre, para el delivery por llamada. */
  static async buscarClientes(business: Business, texto: string) {
    const t = String(texto ?? '').trim()
    if (t.length < 3) return []
    const digitos = t.replace(/\D/g, '')
    const filas = await db
      .from('customers')
      .where('business_id', business.id)
      .where((w) => {
        if (digitos.length >= 3) w.whereILike('phone', `%${digitos}%`)
        w.orWhereRaw(`translate(lower(name), 'áéíóúüñ', 'aeiouun') like ?`, [
          `%${sinTildes(t).toLowerCase()}%`,
        ])
      })
      .orderBy('updated_at', 'desc')
      .limit(8)
      .select('id', 'name', 'phone', 'address', 'city')
    return filas
  }

  /**
   * Asigna un cliente a la cuenta (uno guardado, o uno nuevo con nombre y
   * teléfono). Sirve para buscar la cuenta por cliente y para su historial.
   */
  static async asignarCliente(
    business: Business,
    actor: Actor,
    orderId: number,
    datos: { customerId?: number | null; name?: string | null; phone?: string | null }
  ) {
    return db.transaction(async (trx) => {
      const order = await this.cuentaBloqueada(business, orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirAbierta(order)
      let cliente: { id: number; name: string; phone: string | null } | null = null
      if (datos.customerId) {
        cliente = await trx
          .from('customers')
          .where('business_id', business.id)
          .andWhere('id', Number(datos.customerId))
          .select('id', 'name', 'phone')
          .first()
        if (!cliente) throw new OrderError('Cliente no encontrado')
      } else {
        const nombre = String(datos.name ?? '').trim()
        if (!nombre) throw new OrderError('Escribe el nombre del cliente')
        const telefono = String(datos.phone ?? '').trim()
        if (!telefono) {
          // Sin teléfono no se guarda en la libreta: queda solo en esta cuenta.
          order.customerName = nombre.slice(0, 120)
          order.customerId = null
          order.useTransaction(trx)
          await order.save()
          return { ok: true }
        }
        cliente = await OrderService.registrarCliente(
          business,
          { customerName: nombre, customerPhone: telefono, items: [] },
          trx
        )
      }
      order.customerId = cliente!.id
      order.customerName = cliente!.name
      order.customerPhone = cliente!.phone ?? order.customerPhone
      order.useTransaction(trx)
      await order.save()
      return { ok: true }
    })
  }

  // ------------------------------------------------------------------ mesas

  /** Pasa la cuenta a otra mesa libre (o le asigna una si estaba sin mesa). */
  static async moverMesa(
    business: Business,
    actor: Actor,
    orderId: number,
    tableId: number,
    opciones: ConPin = {}
  ) {
    await PermissionService.exigir(business, actor, 'cuentas.mover_mesa', {
      pin: opciones.pin,
      contexto: `Mover cuenta ${orderId}`,
    })
    await db.transaction(async (trx) => {
      const order = await this.cuentaBloqueada(business, orderId, trx)
      this.exigirVisible(actor, order)
      this.exigirAbierta(order)
      const destino = await DiningTable.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', tableId)
        .andWhere('is_active', true)
        .forUpdate()
        .first()
      if (!destino) throw new OrderError('La mesa no existe')
      if (destino.needsRelease) throw new OrderError(`La mesa ${destino.name} está por liberar`)
      const ocupada = await Order.query({ client: trx })
        .where('dining_table_id', destino.id)
        .andWhere('status', 'abierta')
        .first()
      if (ocupada) throw new OrderError(`La mesa ${destino.name} ya tiene una cuenta abierta`)
      order.merge({
        diningTableId: destino.id,
        tableLabel: destino.name,
        tableReleasedAt: null,
        service: 'comedor',
        // El cliente asignado se conserva; si no hay, la cuenta se nombra por la mesa.
        customerName: order.customerId ? order.customerName : `Mesa ${destino.name}`,
      })
      order.useTransaction(trx)
      await order.save()
    })
    return { ok: true }
  }

  /**
   * Libera una mesa:
   *  - "por liberar" (ya se cobró) → libre;
   *  - con la cuenta impresa → la cuenta sigue abierta sin mesa (el cliente
   *    pasa a pagar a caja) y la mesa queda libre para otros.
   */
  static async liberarMesa(
    business: Business,
    actor: Actor,
    tableId: number,
    opciones: ConPin = {}
  ) {
    await PermissionService.exigir(business, actor, 'cuentas.liberar_mesa', {
      pin: opciones.pin,
      contexto: `Liberar mesa ${tableId}`,
    })
    await db.transaction(async (trx) => {
      const mesa = await DiningTable.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', tableId)
        .forUpdate()
        .first()
      if (!mesa) throw new OrderError('La mesa no existe')
      const abierta = await Order.query({ client: trx })
        .where('dining_table_id', mesa.id)
        .andWhere('status', 'abierta')
        .forUpdate()
        .first()
      if (abierta) {
        this.exigirVisible(actor, abierta)
        if (abierta.accountStatus !== 'impresa') {
          throw new OrderError(
            'Primero imprime la cuenta: así queda con folio para cobrarla en caja'
          )
        }
        abierta.merge({
          diningTableId: null,
          tableLabel: `Mesa ${mesa.name}`,
          tableReleasedAt: DateTime.now(),
        })
        abierta.useTransaction(trx)
        await abierta.save()
      }
      mesa.needsRelease = false
      mesa.useTransaction(trx)
      await mesa.save()
    })
    return { ok: true }
  }

  // --------------------------------------------------------------- impresión

  private static ticketBase(
    business: Business,
    c: Awaited<ReturnType<typeof SalonService.cuenta>>
  ) {
    // Se agrupan las líneas iguales para que el ticket del cliente sea corto.
    const lineas = new Map<string, { cantidad: number; nombre: string; total: number }>()
    for (const i of c.items) {
      if (i.voided) continue
      const nombre =
        [i.name, ...i.modifiers.map((m) => m.name)].join(' + ') + (i.courtesy ? ' (cortesia)' : '')
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
      servicio: c.service,
      mesa: c.etiqueta,
      cliente: c.service !== 'comedor' ? c.customerName : null,
      direccionCliente: c.service === 'delivery' ? c.deliveryAddress : null,
      telefonoCliente: c.service === 'delivery' ? c.customerPhone : null,
      comensales: c.guests,
      cuenta: c.code,
      documento: c.folio,
      folio: c.folio,
      lineas: [...lineas.values()],
      subtotal: c.subtotal,
      descuento: c.discountTotal,
      envio: c.shippingCost,
      motivoDescuento: c.discountReason,
      total: c.total,
      pagos: c.payments,
    }
  }

  /**
   * Encola un ticket. Le adjunta el estilo vigente del negocio para que la
   * central no tenga que pedirlo: lo que se ve en el ticket queda fijo.
   */
  static async encolar(
    trx: TransactionClientContract | null,
    business: Business,
    datos: {
      kind: PrintKind
      printerId: number | null
      orderId: number | null
      payload: Record<string, any>
    }
  ) {
    const ajustes = await PosSettingsService.leer(business)
    const t = ajustes.ticket
    const estilo = {
      general: {
        nombre: t.nombre || business.name,
        ruc: t.ruc || null,
        direccion: t.direccion || null,
        telefono: t.telefono || null,
        encabezado: t.encabezado || null,
        pie: t.pie || null,
        leyenda: t.leyenda || null,
      },
      tipo: t.tipos[ESTILO_DE[datos.kind]],
    }
    return PrintJob.create(
      {
        businessId: business.id,
        printerId: datos.printerId,
        orderId: datos.orderId,
        kind: datos.kind,
        payload: {
          ...datos.payload,
          estilo,
          hora: DateTime.now().setZone('America/Lima').toFormat('dd/LL HH:mm'),
        },
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
    const staff = await db
      .from('business_staff')
      .whereIn('user_id', limpios)
      .select('user_id', 'name')
    for (const s of staff) mapa.set(s.user_id, s.name)
    const users = await db.from('users').whereIn('id', limpios).select('id', 'name')
    for (const u of users) if (!mapa.has(u.id)) mapa.set(u.id, u.name)
    return mapa
  }
}
