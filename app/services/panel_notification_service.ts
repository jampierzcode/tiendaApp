import Notification from '#models/notification'
import type Business from '#models/business'
import type Order from '#models/order'
import logger from '@adonisjs/core/services/logger'

export default class PanelNotificationService {
  /**
   * Aviso de «pedido nuevo» para el panel. Nunca debe tumbar el pedido del
   * cliente: si falla, se registra y se sigue.
   */
  static async pedidoNuevo(business: Business, order: Order) {
    try {
      const total = Number(order.total).toFixed(2)
      await Notification.create({
        businessId: business.id,
        type: 'pedido',
        orderId: order.id,
        title: `Pedido nuevo ${order.code}`,
        body: `${order.customerName} · ${business.currencySymbol ?? 'S/'} ${total}`,
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo crear la notificación del pedido')
    }
  }

  /** Aviso de «mensaje nuevo» de un cliente en un pedido. */
  static async mensajeNuevo(business: Business, order: Order, texto: string) {
    try {
      await Notification.create({
        businessId: business.id,
        type: 'mensaje',
        orderId: order.id,
        title: `Mensaje de ${order.customerName} · ${order.code}`,
        body: texto.slice(0, 120),
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo crear la notificación del mensaje')
    }
  }
}
