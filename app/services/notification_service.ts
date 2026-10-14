import type Business from '#models/business'
import type Order from '#models/order'
import WhatsappOutbox from '#models/whatsapp_outbox'
import WhatsappMessage from '#models/whatsapp_message'
import WhatsappSession from '#models/whatsapp_session'
import env from '#start/env'
import { DateTime } from 'luxon'

export type EventoPedido =
  | 'recibido'
  | 'confirmado'
  | 'preparando'
  | 'listo'
  | 'enviado'
  | 'entregado'
  | 'cancelado'

export const EVENTOS: EventoPedido[] = [
  'recibido',
  'confirmado',
  'preparando',
  'listo',
  'enviado',
  'entregado',
  'cancelado',
]

const PLANTILLAS: Record<EventoPedido, string> = {
  recibido: '¡Hola {{cliente}}! 👋 Recibimos tu pedido {{codigo}} por {{total}}. En breve lo confirmamos.',
  confirmado: '✅ {{cliente}}, tu pedido {{codigo}} fue confirmado. Ya lo estamos organizando.',
  preparando: '👨‍🍳 Tu pedido {{codigo}} se está preparando.',
  listo: '🔔 ¡Tu pedido {{codigo}} está listo! {{entrega}}',
  enviado: '🛵 Tu pedido {{codigo}} va en camino.',
  entregado: '🎉 Pedido {{codigo}} entregado. ¡Gracias por elegirnos, {{cliente}}!',
  cancelado: 'Lo sentimos {{cliente}}, tu pedido {{codigo}} fue cancelado. Escríbenos si tienes dudas.',
}

/**
 * Avisos al cliente por WhatsApp.
 *
 * Solo escribe en la cola `whatsapp_outbox`; quien envía de verdad es el
 * servicio del bot. Así un bot caído no rompe ni retrasa un cambio de estado.
 */
export default class NotificationService {
  static plantillaDe(business: Business, evento: EventoPedido): string {
    try {
      const guardadas = business.notificationTemplates
        ? JSON.parse(business.notificationTemplates)
        : {}
      const propia = guardadas?.[evento]
      if (typeof propia === 'string' && propia.trim()) return propia
    } catch {
      // JSON roto: se usa la de fábrica.
    }
    return PLANTILLAS[evento]
  }

  static plantillasPorDefecto() {
    return PLANTILLAS
  }

  static async notificar(business: Business, order: Order, evento: EventoPedido) {
    if (!order.customerPhone) return

    const sesion = await WhatsappSession.query().where('business_id', business.id).first()
    if (!sesion || sesion.desired !== 'connected') return

    const simbolo = business.currencySymbol || 'S/'
    const entrega =
      order.deliveryMethod === 'recojo' ? 'Puedes pasar a recogerlo.' : ''

    const cuerpo = this.plantillaDe(business, evento)
      .replaceAll('{{cliente}}', order.customerName)
      .replaceAll('{{codigo}}', order.code)
      .replaceAll('{{tienda}}', business.name)
      .replaceAll('{{total}}', `${simbolo} ${Number(order.total).toFixed(2)}`)
      .replaceAll('{{entrega}}', entrega)
      .replaceAll('{{seguimiento}}', this.enlaceSeguimiento(business, order))
      .trim()

    await this.encolar(business, {
      orderId: order.id,
      phone: order.customerPhone,
      event: evento,
      body: cuerpo,
      automatic: true,
    })
  }

  /** Encola el envío y lo deja anotado en la conversación del cliente. */
  static async encolar(
    business: Business,
    m: { orderId?: number | null; phone: string; event: string; body: string; automatic: boolean }
  ) {
    const phone = this.normalizarTelefono(m.phone, business.whatsappPhone)
    await WhatsappOutbox.create({
      businessId: business.id,
      orderId: m.orderId ?? null,
      phone,
      event: m.event,
      body: m.body,
      status: 'pendiente',
      attempts: 0,
    })
    await this.registrar(business.id, phone, 'out', m.body, m.automatic)
  }

  static async registrar(
    businessId: number,
    phone: string,
    direction: 'in' | 'out',
    body: string,
    automatic: boolean
  ) {
    const digitos = phone.replace(/\D/g, '')
    return WhatsappMessage.create({
      businessId,
      phone: digitos,
      contact: digitos.slice(-9),
      direction,
      body,
      automatic,
      readAt: direction === 'out' ? DateTime.now() : null,
    })
  }

  static enlaceSeguimiento(business: Business, order: Order): string {
    const base = (env.get('STORE_PUBLIC_URL') ?? '').replace(/\/$/, '')
    return `${base}/t/${business.slug}/pedido/${order.code}`
  }

  /**
   * Un celular peruano de 9 dígitos no sirve para WhatsApp sin el prefijo
   * del país; se toma el del número del propio negocio.
   */
  static normalizarTelefono(telefono: string, referencia: string | null): string {
    const digitos = telefono.replace(/\D/g, '')
    if (digitos.length > 9) return digitos

    const ref = (referencia ?? '').replace(/\D/g, '')
    const prefijo = ref.length > 9 ? ref.slice(0, ref.length - 9) : '51'
    return `${prefijo}${digitos}`
  }
}
