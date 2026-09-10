import Order, { type OrderStatus } from '#models/order'
import InventoryService, { InsufficientStockError } from '#services/inventory_service'
import OrderService from '#services/order_service'
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
    confirmado: ['pagado', 'enviado', 'cancelado'],
    pagado: ['enviado', 'cancelado'],
    enviado: ['entregado', 'devuelto'],
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
      .preload('items')
      .preload('customer')
      .orderBy('id', 'desc')

    if (status) query.where('status', status)

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

    return {
      status: 'success',
      data: {
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
      .preload('items')
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

    const debeDescontar = nuevo === 'confirmado' && !order.stockCommittedAt
    const debeReponer =
      ['cancelado', 'devuelto'].includes(nuevo) && Boolean(order.stockCommittedAt)

    try {
      await db.transaction(async (trx) => {
        if (debeDescontar) {
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

        if (debeReponer) {
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

    return { status: 'success', message: `Pedido marcado como ${nuevo}`, data: order }
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
