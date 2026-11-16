import type Business from '#models/business'
import Order from '#models/order'
import PurchaseOrder from '#models/purchase_order'
import Shipment, { type EstadoEnvio } from '#models/shipment'
import ShipmentEvent from '#models/shipment_event'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export class ShipmentError extends Error {}

const ESTADOS: EstadoEnvio[] = [
  'preparando',
  'en_transito',
  'en_agencia',
  'entregado',
  'incidencia',
  'cancelado',
]
const TERMINALES: EstadoEnvio[] = ['entregado', 'cancelado']

/**
 * Seguimiento de envíos propios (a clientes) y de compras (de proveedores).
 *
 * Es solo seguimiento: marcar un envío de compra como entregado NO suma stock.
 * El inventario sube cuando se registra la recepción física en la orden.
 */
export default class ShipmentService {
  static async crear(
    business: Business,
    datos: {
      kind: 'compra' | 'pedido'
      purchaseOrderId?: number | null
      orderId?: number | null
      carrier?: string | null
      trackingCode?: string | null
      trackingUrl?: string | null
      pickupKey?: string | null
      agency?: string | null
      estimatedAt?: string | null
      note?: string | null
    },
    userId: number | null
  ) {
    if (datos.kind === 'compra') {
      if (!datos.purchaseOrderId) throw new ShipmentError('Indica la orden de compra')
      const orden = await PurchaseOrder.query()
        .where('id', datos.purchaseOrderId)
        .andWhere('business_id', business.id)
        .first()
      if (!orden) throw new ShipmentError('La orden no pertenece a esta tienda')
      if (['cotizacion', 'cancelada'].includes(orden.status)) {
        throw new ShipmentError('Solo una orden pedida tiene envío')
      }
    } else if (datos.kind === 'pedido') {
      if (!datos.orderId) throw new ShipmentError('Indica el pedido')
      const pedido = await Order.query()
        .where('id', datos.orderId)
        .andWhere('business_id', business.id)
        .first()
      if (!pedido) throw new ShipmentError('El pedido no pertenece a esta tienda')
    } else {
      throw new ShipmentError('El tipo de envío debe ser compra o pedido')
    }

    const url = datos.trackingUrl?.trim() || null
    if (url && !/^https?:\/\//i.test(url)) {
      throw new ShipmentError('El enlace de rastreo debe empezar con http:// o https://')
    }

    return db.transaction(async (trx) => {
      const envio = await Shipment.create(
        {
          businessId: business.id,
          kind: datos.kind,
          purchaseOrderId: datos.kind === 'compra' ? datos.purchaseOrderId! : null,
          orderId: datos.kind === 'pedido' ? datos.orderId! : null,
          carrier: datos.carrier?.trim() || null,
          trackingCode: datos.trackingCode?.trim() || null,
          trackingUrl: url,
          pickupKey: datos.pickupKey?.trim().slice(0, 40) || null,
          agency: datos.agency?.trim().slice(0, 300) || null,
          estimatedAt: datos.estimatedAt || null,
          note: datos.note ?? null,
          status: 'preparando',
        },
        { client: trx }
      )

      await ShipmentEvent.create(
        {
          businessId: business.id,
          shipmentId: envio.id,
          status: 'preparando',
          note: 'Envío registrado',
          happenedAt: DateTime.now(),
          userId,
        },
        { client: trx }
      )

      return envio
    })
  }

  /** Datos del envío que no son el estado (guía, enlace, fecha estimada…). */
  static async actualizar(
    business: Business,
    id: number,
    datos: {
      carrier?: string | null
      trackingCode?: string | null
      trackingUrl?: string | null
      pickupKey?: string | null
      agency?: string | null
      estimatedAt?: string | null
      note?: string | null
    }
  ) {
    const envio = await Shipment.query().where('id', id).andWhere('business_id', business.id).firstOrFail()

    if (datos.trackingUrl !== undefined) {
      const url = datos.trackingUrl?.trim() || null
      if (url && !/^https?:\/\//i.test(url)) {
        throw new ShipmentError('El enlace de rastreo debe empezar con http:// o https://')
      }
      envio.trackingUrl = url
    }
    if (datos.carrier !== undefined) envio.carrier = datos.carrier?.trim() || null
    const guiaNueva =
      datos.trackingCode !== undefined &&
      Boolean(datos.trackingCode?.trim()) &&
      datos.trackingCode?.trim() !== envio.trackingCode
    if (datos.trackingCode !== undefined) envio.trackingCode = datos.trackingCode?.trim() || null
    if (datos.pickupKey !== undefined) envio.pickupKey = datos.pickupKey?.trim().slice(0, 40) || null
    if (datos.agency !== undefined) envio.agency = datos.agency?.trim().slice(0, 300) || null
    if (datos.estimatedAt !== undefined) envio.estimatedAt = datos.estimatedAt || null
    if (datos.note !== undefined) envio.note = datos.note

    await envio.save()
    // Si ya salió y recién se anota la guía, el comprador la recibe por WhatsApp.
    if (guiaNueva && ['en_transito', 'en_agencia'].includes(envio.status)) {
      await this.avisar(business, envio)
    }
    return envio
  }

  /**
   * Avisa al comprador por WhatsApp (solo envíos de pedidos). Nunca rompe el
   * cambio de estado: si el bot no está conectado, simplemente no sale.
   */
  static async avisar(business: Business, envio: Shipment, nota?: string | null) {
    if (envio.kind !== 'pedido' || !envio.orderId) return
    try {
      const order = await Order.find(envio.orderId)
      if (!order) return
      const texto = this.mensajeComprador(business, order, envio, nota)
      if (texto) await NotificationService.avisoLibre(business, order, `envio_${envio.status}`, texto)
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar el envío al comprador')
    }
  }

  static mensajeComprador(business: Business, order: Order, envio: Shipment, nota?: string | null) {
    const quien = envio.carrier || 'la agencia'
    const datos = [
      envio.trackingCode && `Guía / código: *${envio.trackingCode}*`,
      envio.pickupKey && `Clave de recojo: *${envio.pickupKey}*`,
      envio.agency && `Agencia de destino: ${envio.agency}`,
      envio.trackingUrl && `Rastreo: ${envio.trackingUrl}`,
    ]
      .filter(Boolean)
      .join('\n')
    const seguimiento = NotificationService.enlaceSeguimiento(business, order)
    switch (envio.status) {
      case 'en_transito':
        return `📦 ${order.customerName}, tu pedido *${order.code}* ya fue enviado por ${quien}.${datos ? `\n${datos}` : ''}\nSíguelo aquí: ${seguimiento}`
      case 'en_agencia':
        return `📍 ¡Tu pedido *${order.code}* ya llegó a ${quien}!${datos ? `\n${datos}` : ''}\nRecógelo con tu DNI${envio.pickupKey ? ' y la clave' : ''}.`
      case 'incidencia':
        return `⚠️ Hubo un inconveniente con el envío de tu pedido *${order.code}*${nota ? `: ${nota}` : ''}. Te escribimos para resolverlo.`
      default:
        return null
    }
  }

  static async cambiarEstado(
    business: Business,
    id: number,
    estado: EstadoEnvio,
    userId: number,
    nota?: string | null,
    cuando?: string | null
  ) {
    if (!ESTADOS.includes(estado)) {
      throw new ShipmentError(`El estado debe ser uno de: ${ESTADOS.join(', ')}`)
    }

    const envio = await db.transaction(async (trx) => {
      const envio = await Shipment.query({ client: trx })
        .where('id', id)
        .andWhere('business_id', business.id)
        .forUpdate()
        .firstOrFail()

      if (TERMINALES.includes(envio.status)) {
        throw new ShipmentError(`Este envío ya está ${envio.status}`)
      }

      const fecha = cuando ? DateTime.fromISO(cuando) : DateTime.now()
      if (!fecha.isValid) throw new ShipmentError('La fecha no es válida')

      envio.status = estado
      if (estado === 'en_transito' && !envio.shippedAt) envio.shippedAt = fecha
      if (estado === 'entregado') envio.deliveredAt = fecha
      envio.useTransaction(trx)
      await envio.save()

      await ShipmentEvent.create(
        {
          businessId: business.id,
          shipmentId: envio.id,
          status: estado,
          note: nota ?? null,
          happenedAt: fecha,
          userId,
        },
        { client: trx }
      )

      return envio
    })

    await this.avisar(business, envio, nota)
    return envio
  }
}
