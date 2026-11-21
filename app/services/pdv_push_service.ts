import BusinessStaff from '#models/business_staff'
import Order from '#models/order'
import type Business from '#models/business'
import PushService from '#services/push_service'
import logger from '@adonisjs/core/services/logger'

/**
 * Avisos push del PDV: llegan al celular del mesero o de caja aunque Chrome
 * esté en segundo plano o cerrado (como WhatsApp). Con el PDV a la vista, el
 * service worker no los muestra: la propia pantalla avisa con voz.
 * Nunca debe romper la operación que los dispara.
 */
export default class PdvPushService {
  /** Personal entra por /pdv; el dueño usa el PDV de su panel. */
  private static ruta(business: Business, userId: number) {
    return userId === business.userId ? `/b/${business.uuid}/salon` : '/pdv'
  }

  private static etiqueta(o: Order) {
    if (o.diningTableId) return `Mesa ${o.tableLabel ?? ''}`.trim()
    return o.accountName || o.tableLabel || o.customerName || `Cuenta ${o.id}`
  }

  /** Cocina terminó platos: avisa solo a quien abrió la cuenta. */
  static async comandaLista(business: Business, platosPorCuenta: Map<number, string[]>) {
    try {
      if (!platosPorCuenta.size) return
      const cuentas = await Order.query()
        .where('business_id', business.id)
        .whereIn('id', [...platosPorCuenta.keys()])
        .whereNotNull('opened_by_user_id')
      for (const o of cuentas) {
        const platos = platosPorCuenta.get(o.id) ?? []
        await PushService.enviar(o.openedByUserId, {
          title: `Comanda lista · ${this.etiqueta(o)}`,
          body: platos.length ? platos.join(', ') : 'Cocina terminó tu pedido',
          url: this.ruta(business, o.openedByUserId!),
          tag: `listo-${o.id}`,
        })
      }
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar la comanda lista')
    }
  }

  /** Entró un pedido web: avisa a caja y gerencia del local (los meseros no lo atienden). */
  static async pedidoWeb(business: Business, order: Order) {
    try {
      const personal = await BusinessStaff.query()
        .where('business_id', business.id)
        .andWhere('is_active', true)
        .whereIn('role', ['cajero', 'gerente'])
      const total = `${business.currencySymbol ?? 'S/'} ${Number(order.total).toFixed(2)}`
      for (const p of personal) {
        if (p.userId === business.userId) continue
        await PushService.enviar(p.userId, {
          title: `Nuevo pedido ${order.code}`,
          body: `${order.customerName} · ${total}`,
          url: '/pdv',
          tag: `pedido-${order.id}`,
        })
      }
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar el pedido web al personal')
    }
  }
}
