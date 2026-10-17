import Business from '#models/business'
import Customer from '#models/customer'
import Order from '#models/order'
import OrderMessage from '#models/order_message'
import PanelNotificationService from '#services/panel_notification_service'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

const limpiar = (v: unknown) => String(v ?? '').trim().slice(0, 1000)

/**
 * Mensajes dentro de la plataforma, por pedido.
 *
 *  - Panel del negocio: siempre puede escribir (no depende de WhatsApp).
 *  - Cliente con el código de su pedido (`x-claim-token`): lee y responde
 *    desde la página de seguimiento, sin necesidad de cuenta.
 *  - Cliente con cuenta: lo mismo desde «Mi cuenta», en los pedidos ligados.
 */
export default class OrderMessagesController {
  private async lista(order: Order, leer: 'in' | 'out') {
    const mensajes = await OrderMessage.query().where('order_id', order.id).orderBy('id', 'asc').limit(300)
    // Lo que escribió la otra parte se marca como leído al abrir el hilo.
    await OrderMessage.query()
      .where('order_id', order.id)
      .where('direction', leer)
      .whereNull('read_at')
      .update({ read_at: DateTime.now().toSQL() })
    return mensajes
  }

  // --- Panel ---

  public async panelIndex({ business, params, response }: HttpContext) {
    const order = await Order.query().where('business_id', business.id).where('id', params.id).first()
    if (!order) return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    const customer = order.customerId ? await Customer.find(order.customerId) : null
    return {
      status: 'success',
      data: await this.lista(order, 'in'),
      meta: { hasAccount: Boolean(customer?.userId) },
    }
  }

  public async panelStore({ business, params, request, response }: HttpContext) {
    const order = await Order.query().where('business_id', business.id).where('id', params.id).first()
    if (!order) return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    const body = limpiar(request.input('body'))
    if (!body) return response.unprocessableEntity({ status: 'error', message: 'Escribe un mensaje' })
    const m = await OrderMessage.create({ businessId: business.id, orderId: order.id, direction: 'out', body })
    return response.created({ status: 'success', data: m })
  }

  // --- Cliente con el código del pedido ---

  private async pedidoPorCodigo(slug: string, code: string, token: string | undefined) {
    if (!token) return null
    const negocio = await Business.findBy('slug', slug)
    if (!negocio) return null
    const order = await Order.query()
      .where('business_id', negocio.id)
      .where('code', code)
      .where('claim_token', token)
      .first()
    return order ? { order, negocio } : null
  }

  public async publicIndex({ params, request, response }: HttpContext) {
    const r = await this.pedidoPorCodigo(params.slug, params.code, request.header('x-claim-token'))
    if (!r) return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    return { status: 'success', data: await this.lista(r.order, 'out') }
  }

  public async publicStore({ params, request, response }: HttpContext) {
    const r = await this.pedidoPorCodigo(params.slug, params.code, request.header('x-claim-token'))
    if (!r) return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    return this.guardarDelCliente(r.negocio, r.order, request.input('body'), response)
  }

  // --- Cliente con cuenta ---

  private async pedidoDeCuenta(userId: number, slug: string, code: string) {
    const negocio = await Business.findBy('slug', slug)
    if (!negocio) return null
    const order = await Order.query()
      .where('business_id', negocio.id)
      .where('code', code)
      .whereIn('customer_id', Customer.query().where('user_id', userId).select('id'))
      .first()
    return order ? { order, negocio } : null
  }

  public async accountIndex({ auth, params, response }: HttpContext) {
    const r = await this.pedidoDeCuenta(auth.user!.id, params.slug, params.code)
    if (!r) return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    return { status: 'success', data: await this.lista(r.order, 'out') }
  }

  public async accountStore({ auth, params, request, response }: HttpContext) {
    const r = await this.pedidoDeCuenta(auth.user!.id, params.slug, params.code)
    if (!r) return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    return this.guardarDelCliente(r.negocio, r.order, request.input('body'), response)
  }

  private async guardarDelCliente(negocio: Business, order: Order, crudo: unknown, response: HttpContext['response']) {
    const body = limpiar(crudo)
    if (!body) return response.unprocessableEntity({ status: 'error', message: 'Escribe un mensaje' })
    const m = await OrderMessage.create({ businessId: negocio.id, orderId: order.id, direction: 'in', body })
    await PanelNotificationService.mensajeNuevo(negocio, order, body)
    return response.created({ status: 'success', data: m })
  }
}
