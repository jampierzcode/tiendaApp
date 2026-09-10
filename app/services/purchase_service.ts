import type Business from '#models/business'
import Order from '#models/order'
import ProductVariation from '#models/product_variation'
import PurchaseOrder from '#models/purchase_order'
import PurchaseOrderItem from '#models/purchase_order_item'
import ReturnItem from '#models/return_item'
import ReturnNote from '#models/return_note'
import InventoryService from '#services/inventory_service'
import PricingService from '#services/pricing_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export class PurchaseError extends Error {}

interface LineaCompra {
  variationId: number
  quantity: number
  unitCost: number
}

/**
 * Compras a proveedores y devoluciones de clientes: las dos vías por las que
 * la mercadería vuelve al inventario.
 */
export default class PurchaseService {
  /**
   * Crea la orden en borrador. Todavía no toca el inventario: pedirle 50
   * polos al proveedor no es lo mismo que tenerlos en la tienda.
   */
  static async crearOrden(
    business: Business,
    datos: { supplierId: number; documentNumber?: string | null; note?: string | null; items: LineaCompra[] },
    userId: number
  ) {
    if (!datos.items?.length) {
      throw new PurchaseError('La orden de compra no tiene productos')
    }

    const variationIds = datos.items.map((i) => i.variationId)
    const variations = await ProductVariation.query()
      .where('business_id', business.id)
      .whereIn('id', variationIds)

    if (variations.length !== new Set(variationIds).size) {
      throw new PurchaseError('Alguna variación no pertenece a esta tienda')
    }

    return db.transaction(async (trx) => {
      const orden = await PurchaseOrder.create(
        {
          businessId: business.id,
          supplierId: datos.supplierId,
          code: await this.siguienteCodigo(business, trx),
          documentNumber: datos.documentNumber ?? null,
          status: 'borrador',
          note: datos.note ?? null,
          total: 0,
          userId,
        },
        { client: trx }
      )

      let total = 0

      for (const item of datos.items) {
        const cantidad = Math.floor(Number(item.quantity))
        const costo = PricingService.redondear(Number(item.unitCost))

        if (cantidad < 1 || !Number.isFinite(costo) || costo < 0) {
          throw new PurchaseError('Cantidades y costos deben ser válidos')
        }

        const lineTotal = PricingService.redondear(costo * cantidad)
        total += lineTotal

        await PurchaseOrderItem.create(
          {
            businessId: business.id,
            purchaseOrderId: orden.id,
            productVariationId: item.variationId,
            quantity: cantidad,
            unitCost: costo,
            lineTotal,
          },
          { client: trx }
        )
      }

      orden.total = PricingService.redondear(total)
      orden.useTransaction(trx)
      await orden.save()

      await orden.load('items')
      return orden
    })
  }

  /**
   * Recibe la mercadería: entra al inventario por el kardex y actualiza el
   * costo del producto con lo que realmente se pagó.
   */
  static async recibir(business: Business, ordenId: number, userId: number) {
    return db.transaction(async (trx) => {
      const orden = await PurchaseOrder.query({ client: trx })
        .where('id', ordenId)
        .andWhere('business_id', business.id)
        .preload('items')
        .forUpdate()
        .firstOrFail()

      if (orden.status !== 'borrador') {
        throw new PurchaseError(`Esta orden ya está ${orden.status}`)
      }

      for (const item of orden.items) {
        await InventoryService.applyMovement({
          businessId: business.id,
          variationId: item.productVariationId,
          type: 'compra',
          quantity: item.quantity,
          unitCost: item.unitCost,
          referenceType: 'purchase_order',
          referenceId: orden.id,
          note: `Compra ${orden.code}`,
          userId,
          trx,
        })

        // El costo del producto pasa a ser el de la última compra: es lo que
        // hace que el margen del reporte refleje lo que se pagó de verdad.
        const variation = await ProductVariation.query({ client: trx })
          .where('id', item.productVariationId)
          .firstOrFail()

        await trx
          .from('products')
          .where('id', variation.productId)
          .update({ cost: item.unitCost })
      }

      orden.status = 'recibida'
      orden.receivedAt = DateTime.now()
      orden.useTransaction(trx)
      await orden.save()

      return orden
    })
  }

  static async cancelarOrden(business: Business, ordenId: number) {
    const orden = await PurchaseOrder.query()
      .where('id', ordenId)
      .andWhere('business_id', business.id)
      .firstOrFail()

    if (orden.status === 'recibida') {
      throw new PurchaseError(
        'La mercadería ya entró al inventario. Registra una merma si hay que sacarla.'
      )
    }

    orden.status = 'cancelada'
    await orden.save()
    return orden
  }

  /**
   * Devolución de un pedido, total o parcial.
   *
   * No se toca el pedido original: sigue diciendo lo que se vendió. La
   * devolución es un documento aparte que dice lo que volvió.
   */
  static async devolver(
    business: Business,
    datos: {
      orderId: number
      items: { orderItemId: number; quantity: number }[]
      reason?: string | null
      restocked?: boolean
    },
    userId: number
  ) {
    if (!datos.items?.length) {
      throw new PurchaseError('No se indicó qué se devuelve')
    }

    return db.transaction(async (trx) => {
      const order = await Order.query({ client: trx })
        .where('id', datos.orderId)
        .andWhere('business_id', business.id)
        .preload('items')
        .forUpdate()
        .firstOrFail()

      if (!order.stockCommittedAt) {
        throw new PurchaseError(
          'Este pedido no ha descontado stock todavía: cancélalo en vez de devolverlo'
        )
      }

      // Cuánto se devolvió ya de cada línea, para no aceptar más de lo vendido.
      const previas = await trx
        .from('return_items')
        .join('returns', 'returns.id', 'return_items.return_id')
        .where('returns.order_id', order.id)
        .groupBy('return_items.order_item_id')
        .select('return_items.order_item_id')
        .sum('return_items.quantity as devuelto')

      const yaDevuelto = new Map(
        previas.map((p: any) => [Number(p.order_item_id), Number(p.devuelto)])
      )

      const devolucion = await ReturnNote.create(
        {
          businessId: business.id,
          orderId: order.id,
          code: await this.siguienteCodigoDevolucion(business, trx),
          reason: datos.reason ?? null,
          restocked: datos.restocked ?? true,
          total: 0,
          userId,
        },
        { client: trx }
      )

      let total = 0

      for (const linea of datos.items) {
        const item = order.items.find((i) => i.id === linea.orderItemId)

        if (!item) {
          throw new PurchaseError('Una de las líneas no pertenece a este pedido')
        }

        const cantidad = Math.floor(Number(linea.quantity))
        const disponible = item.quantity - (yaDevuelto.get(item.id) ?? 0)

        if (cantidad < 1 || cantidad > disponible) {
          throw new PurchaseError(
            `De "${item.productName}" solo quedan ${disponible} unidades por devolver`
          )
        }

        const lineTotal = PricingService.redondear(Number(item.unitPrice) * cantidad)
        total += lineTotal

        await ReturnItem.create(
          {
            businessId: business.id,
            returnId: devolucion.id,
            orderItemId: item.id,
            quantity: cantidad,
            lineTotal,
          },
          { client: trx }
        )

        if (item.productVariationId) {
          // La prenda siempre vuelve al inventario: es lo que pasó de verdad.
          await InventoryService.applyMovement({
            businessId: business.id,
            variationId: item.productVariationId,
            type: 'devolucion',
            quantity: cantidad,
            referenceType: 'return',
            referenceId: devolucion.id,
            note: `Devolución ${devolucion.code} del pedido ${order.code}`,
            userId,
            trx,
          })

          // Y si vino rota, sale otra vez como merma. Son dos movimientos y
          // no uno con saldo cero, porque el kardex tiene que poder contar
          // qué pasó: volvió, y se perdió.
          if (datos.restocked === false) {
            await InventoryService.applyMovement({
              businessId: business.id,
              variationId: item.productVariationId,
              type: 'merma',
              quantity: -cantidad,
              referenceType: 'return',
              referenceId: devolucion.id,
              note: `Mercadería no revendible de la devolución ${devolucion.code}`,
              userId,
              trx,
            })
          }
        }
      }

      devolucion.total = PricingService.redondear(total)
      devolucion.useTransaction(trx)
      await devolucion.save()

      // Si volvió todo, el pedido queda marcado como devuelto.
      const totalVendido = order.items.reduce((t, i) => t + i.quantity, 0)
      const totalDevuelto =
        [...yaDevuelto.values()].reduce((t, v) => t + v, 0) +
        datos.items.reduce((t, i) => t + Math.floor(Number(i.quantity)), 0)

      if (totalDevuelto >= totalVendido) {
        order.status = 'devuelto'
        order.useTransaction(trx)
        await order.save()
      }

      await devolucion.load('items')
      return devolucion
    })
  }

  private static async siguienteCodigo(business: Business, trx: any) {
    const ultimo = await trx
      .from('purchase_orders')
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .select('code')
      .first()

    const numero = ultimo?.code ? Number(String(ultimo.code).replace(/\D/g, '')) + 1 : 1
    return `OC-${String(numero).padStart(5, '0')}`
  }

  private static async siguienteCodigoDevolucion(business: Business, trx: any) {
    const ultimo = await trx
      .from('returns')
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .select('code')
      .first()

    const numero = ultimo?.code ? Number(String(ultimo.code).replace(/\D/g, '')) + 1 : 1
    return `DV-${String(numero).padStart(5, '0')}`
  }
}
