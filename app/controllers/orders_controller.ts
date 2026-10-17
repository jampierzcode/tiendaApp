import Order, { type OrderStatus } from '#models/order'
import InventoryService, { InsufficientStockError } from '#services/inventory_service'
import OrderService from '#services/order_service'
import IngredientService from '#services/ingredient_service'
import NotificationService, { EVENTOS, type EventoPedido } from '#services/notification_service'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

/**
 * Pedidos vistos desde el panel del negocio.
 */
export default class OrdersController {
  /** Estados a los que se puede pasar desde cada estado. */
  private static transiciones: Record<OrderStatus, OrderStatus[]> = {
    pendiente: ['confirmado', 'cancelado'],
    confirmado: ['pagado', 'preparando', 'enviado', 'cancelado'],
    pagado: ['preparando', 'enviado', 'cancelado'],
    preparando: ['listo', 'cancelado'],
    listo: ['enviado', 'entregado', 'cancelado'],
    enviado: ['entregado', 'devuelto', 'cancelado'],
    entregado: ['devuelto'],
    cancelado: [],
    devuelto: [],
  }

  public async index({ business, request }: HttpContext) {
    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 20))
    const status = request.input('status')
    const search = request.input('search')

    const query = Order.query()
      .where('business_id', business.id)
      .preload('items', (i) => i.preload('modifiers'))
      .preload('customer')
      .orderBy('id', 'desc')

    if (status) query.where('status', status)

    // "Pagado" mira el cobro real, no el estado: el pago puede llegar en
    // cualquier etapa del pedido.
    if (request.input('payment') === 'paid') {
      query
        .where('total', '>', 0)
        .whereRaw('paid_total >= total - 0.01')
        .whereNotIn('status', ['cancelado', 'devuelto'])
    }

    if (search) {
      query.where((sub) => {
        sub
          .whereILike('code', `%${search}%`)
          .orWhereILike('customer_name', `%${search}%`)
          .orWhereILike('customer_phone', `%${search}%`)
      })
    }

    const pedidos = await query.paginate(page, perPage)

    return { status: 'success', ...pedidos.toJSON() }
  }

  /** Conteo por estado, para el tablero. */
  public async summary({ business }: HttpContext) {
    const filas = await db
      .from('orders')
      .where('business_id', business.id)
      .groupBy('status')
      .select('status')
      .count('* as total')

    const porEstado = Object.fromEntries(filas.map((f: any) => [f.status, Number(f.total)]))

    const ventas = await db
      .from('orders')
      .where('business_id', business.id)
      .whereNotIn('status', ['cancelado', 'devuelto'])
      .sum('total as total')
      .first()

    const pagados = await db
      .from('orders')
      .where('business_id', business.id)
      .where('total', '>', 0)
      .whereRaw('paid_total >= total - 0.01')
      .whereNotIn('status', ['cancelado', 'devuelto'])
      .count('* as total')
      .first()

    return {
      status: 'success',
      data: {
        pagados: Number(pagados?.total ?? 0),
        porEstado,
        totalPedidos: filas.reduce((t: number, f: any) => t + Number(f.total), 0),
        ventasAcumuladas: Number(ventas?.total ?? 0),
      },
    }
  }

  public async show({ params, business }: HttpContext) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .preload('items', (i) => i.preload('modifiers'))
      .preload('customer')
      .preload('payments', (p) => p.preload('receipt').orderBy('paid_at', 'desc'))
      .firstOrFail()

    await order.load('business')

    return {
      status: 'success',
      data: order,
      whatsappUrl: OrderService.construirUrlWhatsapp(business, order),
    }
  }

  /**
   * Cambia el estado del pedido.
   *
   * Confirmar es lo que descuenta el inventario: hasta entonces el pedido de
   * WhatsApp es solo una intención, y reservar stock por cada carrito
   * abandonado dejaría la tienda en cero. Cancelar o devolver un pedido ya
   * confirmado repone lo descontado.
   */
  public async updateStatus({ params, request, business, auth, response }: HttpContext) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .preload('items')
      .firstOrFail()

    const nuevo = request.input('status') as OrderStatus
    const permitidos = OrdersController.transiciones[order.status] ?? []

    if (!permitidos.includes(nuevo)) {
      return response.unprocessableEntity({
        status: 'error',
        message: permitidos.length
          ? `Un pedido ${order.status} solo puede pasar a: ${permitidos.join(', ')}`
          : `Un pedido ${order.status} ya no cambia de estado`,
      })
    }

    // Política de cobro: pago por adelantado (al confirmar) o contra entrega
    // (al entregar). Se puede saltar a propósito con allowUnpaid.
    const exige =
      (business.paymentPolicy === 'on_confirm' && nuevo === 'confirmado') ||
      (business.paymentPolicy === 'on_delivery' && nuevo === 'entregado')
    if (exige && order.saldoPendiente > 0.009 && request.input('allowUnpaid') !== true) {
      return response.status(422).send({
        status: 'error',
        code: 'PAYMENT_REQUIRED',
        message:
          business.paymentPolicy === 'on_confirm'
            ? 'Este negocio cobra por adelantado: registra el pago antes de confirmar.'
            : 'Este negocio cobra contra entrega: registra el pago al entregar.',
        data: { saldo: order.saldoPendiente, total: Number(order.total) },
      })
    }

    // Tienda: se descuenta stock de las variaciones. Restaurante: se descuentan
    // los insumos de la receta. En ambos casos solo al confirmar, una vez.
    const debeDescontar = nuevo === 'confirmado' && !order.stockCommittedAt
    const debeReponer =
      ['cancelado', 'devuelto'].includes(nuevo) && Boolean(order.stockCommittedAt)
    let platosSinReceta: string[] = []

    try {
      await db.transaction(async (trx) => {
        if (debeDescontar && business.esRestaurante) {
          const r = await IngredientService.consumirPedido(order, trx, auth.user!.id)
          platosSinReceta = r.sinReceta
          order.stockCommittedAt = DateTime.now()
        } else if (debeDescontar) {
          for (const item of order.items) {
            if (!item.productVariationId) continue
            await InventoryService.applyMovement({
              businessId: business.id,
              variationId: item.productVariationId,
              type: 'venta',
              quantity: -item.quantity,
              referenceType: 'order',
              referenceId: order.id,
              note: `Pedido ${order.code}`,
              userId: auth.user!.id,
              trx,
            })
          }
          order.stockCommittedAt = DateTime.now()
        }

        if (debeReponer && business.esRestaurante) {
          await IngredientService.reponerPedido(order, trx, auth.user!.id)
          order.stockCommittedAt = null
        } else if (debeReponer) {
          for (const item of order.items) {
            if (!item.productVariationId) continue
            await InventoryService.applyMovement({
              businessId: business.id,
              variationId: item.productVariationId,
              type: 'devolucion',
              quantity: item.quantity,
              referenceType: 'order',
              referenceId: order.id,
              note: `Reposición por pedido ${nuevo}: ${order.code}`,
              userId: auth.user!.id,
              trx,
            })
          }
          order.stockCommittedAt = null
        }

        if (nuevo === 'listo' && !order.readyAt) order.readyAt = DateTime.now()
        if (nuevo === 'enviado' && !order.shippedAt) order.shippedAt = DateTime.now()
        if (nuevo === 'entregado' && !order.deliveredAt) order.deliveredAt = DateTime.now()

        order.status = nuevo
        order.useTransaction(trx)
        await order.save()
      })
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return response.unprocessableEntity({
          status: 'error',
          message: `No se puede confirmar: ${error.message}`,
        })
      }
      throw error
    }

    // Aviso al cliente: si el bot está caído o el negocio no lo usa, no pasa nada.
    if (request.input('notify', true) !== false && EVENTOS.includes(nuevo as EventoPedido)) {
      try {
        await NotificationService.notificar(business, order, nuevo as EventoPedido)
      } catch {
        // La notificación nunca debe tumbar un cambio de estado.
      }
    }

    return {
      status: 'success',
      message: `Pedido marcado como ${nuevo}`,
      data: order,
      // Platos que se vendieron sin receta: su consumo no quedó registrado.
      warnings: platosSinReceta.length
        ? [`Sin receta, no se descontó inventario de: ${platosSinReceta.join(', ')}`]
        : [],
    }
  }

  /**
   * Datos de envío: courier, número de guía y enlace de seguimiento.
   *
   * Se registran a mano. Los couriers que usan las tiendas pequeñas en Perú
   * (Olva, Shalom) no ofrecen API abierta, así que integrar el seguimiento
   * automático no entra en lo cotizado.
   */
  public async updateShipping({ params, request, business }: HttpContext) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    const data = request.only(['courier', 'tracking_code', 'tracking_url'])

    order.merge({
      courier: data.courier ?? order.courier,
      trackingCode: data.tracking_code ?? order.trackingCode,
      trackingUrl: data.tracking_url ?? order.trackingUrl,
    })

    await order.save()

    return { status: 'success', message: 'Datos de envío guardados', data: order }
  }
}
