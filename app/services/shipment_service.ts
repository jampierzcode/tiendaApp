import type Business from '#models/business'
import Order from '#models/order'
import PurchaseOrder from '#models/purchase_order'
import Shipment, { type EstadoEnvio } from '#models/shipment'
import ShipmentEvent from '#models/shipment_event'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export class ShipmentError extends Error {}

const ESTADOS: EstadoEnvio[] = ['preparando', 'en_transito', 'entregado', 'incidencia', 'cancelado']
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
      estimatedAt?: string | null
      note?: string | null
    },
    userId: number
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
    if (datos.trackingCode !== undefined) envio.trackingCode = datos.trackingCode?.trim() || null
    if (datos.estimatedAt !== undefined) envio.estimatedAt = datos.estimatedAt || null
    if (datos.note !== undefined) envio.note = datos.note

    await envio.save()
    return envio
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

    return db.transaction(async (trx) => {
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
  }
}
