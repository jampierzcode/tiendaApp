import type Business from '#models/business'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Payment, { type MetodoPago } from '#models/payment'
import InventoryService from '#services/inventory_service'
import { OrderError } from '#services/order_service'
import OrderService from '#services/order_service'
import PricingService from '#services/pricing_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export interface LineaMostrador {
  variationId: number
  quantity: number
  /** Precio manual, si el vendedor lo cambió en caja. */
  unitPrice?: number
}

export interface VentaMostrador {
  items: LineaMostrador[]
  payments: { method: MetodoPago; amount: number; reference?: string | null }[]
  customerName?: string | null
  customerPhone?: string | null
  /** Descuento sobre el total de la venta, en porcentaje. */
  discountPercentage?: number
  note?: string | null
  userId: number
}

const SERIE_TICKET = 'T001'

/**
 * Venta en mostrador.
 *
 * Se guarda como un `order` con `channel = 'mostrador'` que nace pagado y con
 * el stock ya descontado: en caja no hay nada que confirmar después, el
 * cliente paga y se lleva la ropa.
 *
 * Reutilizar `orders` en vez de crear una tabla de ventas aparte es lo que
 * mantiene el inventario, los cobros y los reportes en un solo sitio.
 */
export default class PosService {
  static async vender(business: Business, venta: VentaMostrador) {
    if (!venta.items?.length) {
      throw new OrderError('La venta no tiene productos')
    }

    const cantidades = new Map<number, { cantidad: number; precio?: number }>()
    for (const item of venta.items) {
      const cantidad = Math.floor(Number(item.quantity))
      if (!Number.isFinite(cantidad) || cantidad < 1) {
        throw new OrderError('Las cantidades deben ser enteros positivos')
      }
      const previo = cantidades.get(item.variationId)
      cantidades.set(item.variationId, {
        cantidad: (previo?.cantidad ?? 0) + cantidad,
        precio: item.unitPrice ?? previo?.precio,
      })
    }

    const variationIds = [...cantidades.keys()]

    const variations = await ProductVariation.query()
      .where('business_id', business.id)
      .whereIn('id', variationIds)
      .preload('attributes', (a) => a.preload('value', (v) => v.preload('attribute')))

    if (variations.length !== variationIds.length) {
      throw new OrderError('Alguno de los productos no existe en esta tienda')
    }

    const products = await Product.query()
      .where('business_id', business.id)
      .whereIn(
        'id',
        variations.map((v) => v.productId)
      )
      .preload('discounts')

    const productoPorId = new Map(products.map((p) => [p.id, p]))

    // El stock se comprueba entero antes de escribir nada, para avisar de
    // todo lo que falta de una vez en lugar de fallar en la primera línea.
    const faltantes: string[] = []
    for (const variation of variations) {
      const pedida = cantidades.get(variation.id)!.cantidad
      if (variation.stock < pedida) {
        const producto = productoPorId.get(variation.productId)
        faltantes.push(
          `${producto?.name ?? 'Producto'} ${OrderService.etiquetaVariacion(variation)}`.trim() +
            ` (quedan ${variation.stock})`
        )
      }
    }

    if (faltantes.length) {
      throw new OrderError(`Sin stock suficiente: ${faltantes.join(', ')}`)
    }

    const descuentoGeneral = Math.min(Math.max(Number(venta.discountPercentage ?? 0), 0), 100)

    return db.transaction(async (trx) => {
      const { code, serie, numero } = await this.siguienteTicket(business, trx)

      const order = await Order.create(
        {
          businessId: business.id,
          code,
          documentSeries: serie,
          documentNumber: numero,
          channel: 'mostrador',
          status: 'pagado',
          customerName: venta.customerName?.trim() || 'Cliente de mostrador',
          customerPhone: venta.customerPhone?.trim() || null,
          deliveryMethod: 'recojo',
          note: venta.note?.trim() || null,
          currency: business.currency,
          subtotal: 0,
          discountTotal: 0,
          shippingCost: 0,
          total: 0,
          paidTotal: 0,
          stockCommittedAt: DateTime.now(),
        },
        { client: trx }
      )

      let subtotal = 0
      let descuentoTotal = 0

      for (const variation of variations) {
        const { cantidad, precio: precioManual } = cantidades.get(variation.id)!
        const producto = productoPorId.get(variation.productId)!

        const precioLista = Number(variation.price) + Number(variation.priceModifier ?? 0)
        const conPromo = PricingService.calcular(precioLista, producto.discounts)

        // Si el vendedor tecleó un precio en caja, manda ese.
        const precioFinal =
          precioManual !== undefined && precioManual !== null
            ? PricingService.redondear(Number(precioManual))
            : conPromo.final

        const lineTotal = PricingService.redondear(precioFinal * cantidad)
        subtotal += PricingService.redondear(precioLista * cantidad)
        descuentoTotal += PricingService.redondear((precioLista - precioFinal) * cantidad)

        await OrderItem.create(
          {
            businessId: business.id,
            orderId: order.id,
            productId: producto.id,
            productVariationId: variation.id,
            productName: producto.name,
            sku: variation.sku ?? producto.sku,
            variationLabel: OrderService.etiquetaVariacion(variation),
            unitPrice: precioFinal,
            unitCost: producto.cost,
            discountPercentage: conPromo.descuento,
            quantity: cantidad,
            lineTotal,
          },
          { client: trx }
        )

        // En mostrador la salida es inmediata: no hay estado intermedio.
        await InventoryService.applyMovement({
          businessId: business.id,
          variationId: variation.id,
          type: 'venta',
          quantity: -cantidad,
          referenceType: 'order',
          referenceId: order.id,
          note: `Venta en mostrador ${code}`,
          userId: venta.userId,
          trx,
        })
      }

      // Descuento global aplicado sobre lo que quedó después de las promos.
      const neto = PricingService.redondear(subtotal - descuentoTotal)
      const rebajaGeneral = PricingService.redondear((neto * descuentoGeneral) / 100)
      const total = PricingService.redondear(neto - rebajaGeneral)

      order.subtotal = PricingService.redondear(subtotal)
      order.discountTotal = PricingService.redondear(descuentoTotal + rebajaGeneral)
      order.total = total

      const cobrado = (venta.payments ?? []).reduce((t, p) => t + Number(p.amount), 0)

      if (PricingService.redondear(cobrado) < total - 0.01) {
        throw new OrderError(
          `Falta cobrar: el total es ${total.toFixed(2)} y se registraron ${cobrado.toFixed(2)}`
        )
      }

      // Lo cobrado de más es el vuelto, no un pago: se registra el total.
      let restante = total
      for (const pago of venta.payments) {
        if (restante <= 0) break
        const monto = PricingService.redondear(Math.min(Number(pago.amount), restante))
        restante = PricingService.redondear(restante - monto)

        await Payment.create(
          {
            businessId: business.id,
            orderId: order.id,
            method: pago.method,
            amount: monto,
            reference: pago.reference ?? null,
            paidAt: DateTime.now(),
            userId: venta.userId,
          },
          { client: trx }
        )
      }

      order.paidTotal = total
      order.useTransaction(trx)
      await order.save()

      await order.load('items')

      return {
        order,
        vuelto: PricingService.redondear(cobrado - total),
      }
    })
  }

  /** Serie fija y correlativo por negocio. Enganche para SUNAT más adelante. */
  private static async siguienteTicket(business: Business, trx: any) {
    const ultimo = await trx
      .from('orders')
      .where('business_id', business.id)
      .andWhere('document_series', SERIE_TICKET)
      .max('document_number as ultimo')
      .first()

    const numero = Number(ultimo?.ultimo ?? 0) + 1

    return {
      serie: SERIE_TICKET,
      numero,
      code: `${SERIE_TICKET}-${String(numero).padStart(6, '0')}`,
    }
  }
}
