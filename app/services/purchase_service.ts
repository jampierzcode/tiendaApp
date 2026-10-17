import type Business from '#models/business'
import Order from '#models/order'
import ProductVariation from '#models/product_variation'
import PriceReview from '#models/price_review'
import Product from '#models/product'
import PurchaseOrder from '#models/purchase_order'
import PurchaseOrderItem from '#models/purchase_order_item'
import PurchaseReceipt from '#models/purchase_receipt'
import PurchaseReceiptItem from '#models/purchase_receipt_item'
import ReturnItem from '#models/return_item'
import ReturnNote from '#models/return_note'
import Supplier from '#models/supplier'
import InventoryService from '#services/inventory_service'
import PricingService from '#services/pricing_service'
import VariationService from '#services/variation_service'
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
   * Crea una cotización o una orden. Ninguna toca todavía el inventario ni el
   * costo: pedirle 50 polos al proveedor no es lo mismo que tenerlos, y una
   * cotización es solo un precio consultado.
   */
  static async crearOrden(
    business: Business,
    datos: {
      supplierId: number
      documentNumber?: string | null
      note?: string | null
      expectedAt?: string | null
      /** `cotizacion` no genera pedido; `orden` (por defecto) sí. */
      tipo?: 'cotizacion' | 'orden'
      items: LineaCompra[]
    },
    userId: number
  ) {
    if (!datos.items?.length) {
      throw new PurchaseError('La orden de compra no tiene productos')
    }

    await this.exigirProveedor(business, datos.supplierId)

    const variationIds = datos.items.map((i) => i.variationId)
    const variations = await ProductVariation.query()
      .where('business_id', business.id)
      .whereIn('id', variationIds)
      .whereRaw(`NOT ${VariationService.SQL_DEFAULT_RETIRADA}`)

    if (variations.length !== new Set(variationIds).size) {
      throw new PurchaseError('Alguna variación no pertenece a esta tienda o ya no se vende sola')
    }

    const cotiza = datos.tipo === 'cotizacion'

    return db.transaction(async (trx) => {
      const orden = await PurchaseOrder.create(
        {
          businessId: business.id,
          supplierId: datos.supplierId,
          code: await this.siguienteCodigo(business, trx, cotiza ? 'CT' : 'OC'),
          documentNumber: datos.documentNumber ?? null,
          status: cotiza ? 'cotizacion' : 'borrador',
          note: datos.note ?? null,
          expectedAt: datos.expectedAt ?? null,
          confirmedAt: cotiza ? null : DateTime.now(),
          total: 0,
          userId,
        },
        { client: trx }
      )

      orden.total = await this.guardarLineas(business, orden, datos.items, trx)
      orden.useTransaction(trx)
      await orden.save()

      await orden.load('items')
      return orden
    })
  }

  /**
   * Cambios sobre una orden que todavía no recibió nada: proveedor, documento,
   * nota, fecha estimada y (solo en cotización) las líneas. Cambiar de
   * proveedor no pierde historial: cada orden conserva el suyo y el historial
   * de costos se arma por orden.
   */
  static async actualizar(
    business: Business,
    ordenId: number,
    datos: {
      supplierId?: number
      documentNumber?: string | null
      note?: string | null
      expectedAt?: string | null
      items?: LineaCompra[]
    }
  ) {
    return db.transaction(async (trx) => {
      const orden = await this.cargarBloqueada(business, ordenId, trx)

      if (!['cotizacion', 'borrador'].includes(orden.status)) {
        throw new PurchaseError(`Una orden ${orden.status} ya no se puede modificar`)
      }
      if (await this.tieneRecepciones(orden.id, trx)) {
        throw new PurchaseError('Ya entró mercadería de esta orden: no se puede cambiar')
      }

      if (datos.supplierId !== undefined && datos.supplierId !== orden.supplierId) {
        await this.exigirProveedor(business, datos.supplierId)
        orden.supplierId = datos.supplierId
      }
      if (datos.documentNumber !== undefined) orden.documentNumber = datos.documentNumber
      if (datos.note !== undefined) orden.note = datos.note
      if (datos.expectedAt !== undefined) orden.expectedAt = datos.expectedAt

      if (datos.items) {
        if (orden.status !== 'cotizacion') {
          throw new PurchaseError('Las líneas solo se editan mientras es cotización')
        }
        await trx.from('purchase_order_items').where('purchase_order_id', orden.id).delete()
        orden.total = await this.guardarLineas(business, orden, datos.items, trx)
      }

      orden.useTransaction(trx)
      await orden.save()
      await orden.load('items')
      return orden
    })
  }

  /** Convierte la cotización en pedido real (puede ser a otro proveedor). */
  static async confirmarCotizacion(business: Business, ordenId: number, supplierId?: number) {
    return db.transaction(async (trx) => {
      const orden = await this.cargarBloqueada(business, ordenId, trx)

      if (orden.status !== 'cotizacion') {
        throw new PurchaseError('Solo una cotización se puede convertir en pedido')
      }

      if (supplierId && supplierId !== orden.supplierId) {
        await this.exigirProveedor(business, supplierId)
        orden.supplierId = supplierId
      }

      orden.code = await this.siguienteCodigo(business, trx, 'OC')
      orden.status = 'borrador'
      orden.confirmedAt = DateTime.now()
      orden.useTransaction(trx)
      await orden.save()
      return orden
    })
  }

  /**
   * Registra una entrada física de mercadería (total o parcial).
   *
   * Cada línea tiene un tope: lo pedido menos lo ya recibido. Por eso repetir
   * la misma recepción, o recibir "todo" dos veces, no duplica inventario. El
   * stock entra por el kardex y solo aquí.
   */
  static async recibirParcial(
    business: Business,
    ordenId: number,
    datos: {
      items: { itemId: number; quantity: number }[]
      note?: string | null
      documentNumber?: string | null
      shipmentId?: number | null
    },
    userId: number
  ) {
    if (!datos.items?.length) {
      throw new PurchaseError('Indica qué mercadería llegó')
    }

    return db.transaction(async (trx) => {
      const orden = await PurchaseOrder.query({ client: trx })
        .where('id', ordenId)
        .andWhere('business_id', business.id)
        .preload('items')
        .forUpdate()
        .firstOrFail()

      if (orden.status === 'cotizacion') {
        throw new PurchaseError('Una cotización no genera stock: conviértela en pedido primero')
      }
      if (!['borrador', 'parcial'].includes(orden.status)) {
        throw new PurchaseError(`Esta orden ya está ${orden.status}`)
      }

      if (datos.shipmentId) {
        const envio = await trx
          .from('shipments')
          .where('id', datos.shipmentId)
          .andWhere('business_id', business.id)
          .first()
        if (!envio) throw new PurchaseError('El envío indicado no pertenece a esta tienda')
      }

      const receipt = await PurchaseReceipt.create(
        {
          businessId: business.id,
          purchaseOrderId: orden.id,
          shipmentId: datos.shipmentId ?? null,
          code: await this.siguienteCodigoRecepcion(business, trx),
          documentNumber: datos.documentNumber ?? orden.documentNumber,
          note: datos.note ?? null,
          userId,
        },
        { client: trx }
      )

      const revisiones: PriceReview[] = []
      const vistos = new Set<number>()

      for (const linea of datos.items) {
        const item = orden.items.find((i) => i.id === Number(linea.itemId))
        if (!item) throw new PurchaseError('Una línea no pertenece a esta orden')
        if (vistos.has(item.id)) throw new PurchaseError('Una línea viene repetida en la recepción')
        vistos.add(item.id)

        const cantidad = Math.floor(Number(linea.quantity))
        const pendiente = item.quantity - item.receivedQuantity
        if (!Number.isFinite(cantidad) || cantidad < 1) {
          throw new PurchaseError('Las cantidades recibidas deben ser mayores a cero')
        }
        if (cantidad > pendiente) {
          throw new PurchaseError(`Solo faltan ${pendiente} por recibir de una línea (llegaron ${cantidad})`)
        }

        const costo = Number(item.unitCost)

        await InventoryService.applyMovement({
          businessId: business.id,
          variationId: item.productVariationId,
          type: 'compra',
          quantity: cantidad,
          unitCost: costo,
          referenceType: 'purchase_receipt',
          referenceId: receipt.id,
          note: `Recepción ${receipt.code} de ${orden.code}`,
          userId,
          trx,
        })

        await PurchaseReceiptItem.create(
          {
            businessId: business.id,
            receiptId: receipt.id,
            purchaseOrderItemId: item.id,
            productVariationId: item.productVariationId,
            quantity: cantidad,
            unitCost: costo,
          },
          { client: trx }
        )

        item.receivedQuantity += cantidad
        item.useTransaction(trx)
        await item.save()

        const revision = await this.registrarCosto(
          business,
          item.productVariationId,
          costo,
          orden.supplierId,
          receipt.id,
          trx
        )
        if (revision) revisiones.push(revision)
      }

      const completa = orden.items.every((i) => i.receivedQuantity >= i.quantity)
      orden.status = completa ? 'recibida' : 'parcial'
      if (completa) orden.receivedAt = DateTime.now()
      orden.useTransaction(trx)
      await orden.save()

      await receipt.load('items')
      return { orden, receipt, revisiones }
    })
  }

  /** Recibe de una vez todo lo que falte: es lo que hacía el botón «Recibir». */
  static async recibir(business: Business, ordenId: number, userId: number) {
    const orden = await PurchaseOrder.query()
      .where('id', ordenId)
      .andWhere('business_id', business.id)
      .preload('items')
      .firstOrFail()

    if (orden.status === 'cotizacion') {
      throw new PurchaseError('Una cotización no genera stock: conviértela en pedido primero')
    }
    if (!['borrador', 'parcial'].includes(orden.status)) {
      throw new PurchaseError(`Esta orden ya está ${orden.status}`)
    }

    const pendientes = orden.items
      .filter((i) => i.quantity > i.receivedQuantity)
      .map((i) => ({ itemId: i.id, quantity: i.quantity - i.receivedQuantity }))

    const { orden: actualizada } = await this.recibirParcial(business, ordenId, { items: pendientes }, userId)
    return actualizada
  }

  /** Da por terminada una orden parcial: lo que no llegó ya no se espera. */
  static async cerrar(business: Business, ordenId: number, note?: string | null) {
    return db.transaction(async (trx) => {
      const orden = await this.cargarBloqueada(business, ordenId, trx)
      if (orden.status !== 'parcial') {
        throw new PurchaseError('Solo se cierra una orden con recepciones parciales')
      }
      orden.status = 'recibida'
      orden.closedAt = DateTime.now()
      orden.receivedAt = orden.receivedAt ?? DateTime.now()
      if (note) orden.note = [orden.note, note].filter(Boolean).join(' · ')
      orden.useTransaction(trx)
      await orden.save()
      return orden
    })
  }

  static async cancelarOrden(business: Business, ordenId: number) {
    return db.transaction(async (trx) => {
      const orden = await this.cargarBloqueada(business, ordenId, trx)

      if (orden.status === 'recibida' || orden.status === 'parcial') {
        throw new PurchaseError(
          orden.status === 'parcial'
            ? 'Ya entró parte de la mercadería. Cierra la orden para dejar de esperar el resto.'
            : 'La mercadería ya entró al inventario. Registra una merma si hay que sacarla.'
        )
      }

      orden.status = 'cancelada'
      orden.useTransaction(trx)
      await orden.save()
      return orden
    })
  }

  /**
   * Historial de costos por proveedor para una variación (o todo el producto).
   * Sale de las órdenes, que nunca se reescriben: cambiar de proveedor a una
   * orden futura no borra lo que cada uno cobró antes. Las cotizaciones van
   * aparte: son precios consultados, no pagados.
   */
  static async historialCostos(
    business: Business,
    filtro: { variationId?: number; productId?: number }
  ) {
    const query = db
      .from('purchase_order_items as i')
      .join('purchase_orders as o', 'o.id', 'i.purchase_order_id')
      .join('suppliers as s', 's.id', 'o.supplier_id')
      .join('product_variations as v', 'v.id', 'i.product_variation_id')
      .where('o.business_id', business.id)
      .whereNot('o.status', 'cancelada')
      .select(
        'o.id as orderId',
        'o.code',
        'o.status',
        'o.created_at as fecha',
        's.id as supplierId',
        's.name as supplier',
        'i.unit_cost as unitCost',
        'i.quantity',
        'i.received_quantity as receivedQuantity',
        'i.product_variation_id as variationId'
      )
      .orderBy('o.created_at', 'desc')

    if (filtro.variationId) query.where('i.product_variation_id', filtro.variationId)
    else if (filtro.productId) query.where('v.product_id', filtro.productId)
    else throw new PurchaseError('Indica la variación o el producto')

    const filas = (await query).map((f: any) => ({
      ...f,
      unitCost: Number(f.unitCost),
      cotizacion: f.status === 'cotizacion',
    }))

    const porProveedor = new Map<number, any>()
    for (const f of filas) {
      const p = porProveedor.get(f.supplierId) ?? {
        supplierId: f.supplierId,
        supplier: f.supplier,
        compras: 0,
        ultimoCosto: null as number | null,
        ultimaFecha: null as string | null,
        minimo: null as number | null,
        promedio: null as number | null,
        cotizado: null as { costo: number; fecha: string } | null,
        suma: 0,
      }
      if (f.cotizacion) {
        // Filas ordenadas de nuevas a viejas: la primera es la cotización vigente.
        p.cotizado = p.cotizado ?? { costo: f.unitCost, fecha: f.fecha }
      } else {
        p.compras += 1
        p.suma += f.unitCost
        p.ultimoCosto = p.ultimoCosto ?? f.unitCost
        p.ultimaFecha = p.ultimaFecha ?? f.fecha
        p.minimo = p.minimo === null ? f.unitCost : Math.min(p.minimo, f.unitCost)
      }
      porProveedor.set(f.supplierId, p)
    }

    const proveedores = [...porProveedor.values()].map(({ suma, ...p }) => ({
      ...p,
      promedio: p.compras ? PricingService.redondear(suma / p.compras) : null,
    }))

    return { proveedores, movimientos: filas.slice(0, 30) }
  }

  // --- Costos y precios ---

  /**
   * Guarda el costo pagado en la variación y en el producto (para el margen de
   * ventas futuras). Si el costo SUBIÓ deja una revisión de precio pendiente;
   * el precio de venta no se toca. Las ventas pasadas guardan su propio costo
   * y precio (`order_items`), así que tampoco cambian.
   */
  private static async registrarCosto(
    business: Business,
    variationId: number,
    costoNuevo: number,
    supplierId: number,
    receiptId: number,
    trx: any
  ) {
    const variation = await ProductVariation.query({ client: trx })
      .where('id', variationId)
      .firstOrFail()
    const product = await Product.query({ client: trx }).where('id', variation.productId).firstOrFail()

    const anterior =
      variation.cost !== null && variation.cost !== undefined
        ? Number(variation.cost)
        : product.cost !== null && product.cost !== undefined
          ? Number(product.cost)
          : null

    await trx.from('products').where('id', product.id).update({ cost: costoNuevo })
    await trx.from('product_variations').where('id', variation.id).update({ cost: costoNuevo })

    if (anterior === null || costoNuevo <= anterior + 0.004) return null

    const precio = Number(product.price)
    const { precio: sugerido } = PricingService.sugerirPrecio(costoNuevo, precio, anterior)

    // Una sola revisión abierta por producto: se actualiza con el último costo.
    const abierta = await PriceReview.query({ client: trx })
      .where('business_id', business.id)
      .andWhere('product_id', product.id)
      .andWhere('status', 'pendiente')
      .first()

    if (abierta) {
      abierta.newCost = Math.max(Number(abierta.newCost), costoNuevo)
      abierta.suggestedPrice = PricingService.sugerirPrecio(
        abierta.newCost,
        precio,
        Number(abierta.oldCost)
      ).precio
      abierta.currentPrice = precio
      abierta.purchaseReceiptId = receiptId
      abierta.supplierId = supplierId
      abierta.useTransaction(trx)
      await abierta.save()
      return abierta
    }

    return PriceReview.create(
      {
        businessId: business.id,
        productId: product.id,
        purchaseReceiptId: receiptId,
        supplierId,
        oldCost: anterior,
        newCost: costoNuevo,
        currentPrice: precio,
        suggestedPrice: sugerido,
        status: 'pendiente',
      },
      { client: trx }
    )
  }

  // --- Internos ---

  private static async exigirProveedor(business: Business, supplierId: number) {
    const proveedor = await Supplier.query()
      .where('id', supplierId)
      .andWhere('business_id', business.id)
      .first()
    if (!proveedor) throw new PurchaseError('El proveedor no pertenece a esta tienda')
  }

  private static async cargarBloqueada(business: Business, ordenId: number, trx: any) {
    return PurchaseOrder.query({ client: trx })
      .where('id', ordenId)
      .andWhere('business_id', business.id)
      .forUpdate()
      .firstOrFail()
  }

  private static async tieneRecepciones(ordenId: number, trx: any) {
    const fila = await trx
      .from('purchase_receipts')
      .where('purchase_order_id', ordenId)
      .count('* as total')
      .first()
    return Number(fila?.total ?? 0) > 0
  }

  private static async guardarLineas(
    business: Business,
    orden: PurchaseOrder,
    items: LineaCompra[],
    trx: any
  ) {
    if (!items.length) throw new PurchaseError('La orden de compra no tiene productos')

    const ids = items.map((i) => i.variationId)
    const existentes = await ProductVariation.query({ client: trx })
      .where('business_id', business.id)
      .whereIn('id', ids)
      .whereRaw(`NOT ${VariationService.SQL_DEFAULT_RETIRADA}`)
    if (existentes.length !== new Set(ids).size) {
      throw new PurchaseError('Alguna variación no pertenece a esta tienda o ya no se vende sola')
    }

    let total = 0
    for (const item of items) {
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
          receivedQuantity: 0,
        },
        { client: trx }
      )
    }
    return PricingService.redondear(total)
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

  private static async siguienteCodigoRecepcion(business: Business, trx: any) {
    const ultimo = await trx
      .from('purchase_receipts')
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .select('code')
      .first()

    const numero = ultimo?.code ? Number(String(ultimo.code).replace(/\D/g, '')) + 1 : 1
    return `RC-${String(numero).padStart(5, '0')}`
  }

  private static async siguienteCodigo(business: Business, trx: any, prefijo = 'OC') {
    const ultimo = await trx
      .from('purchase_orders')
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .select('code')
      .first()

    const numero = ultimo?.code ? Number(String(ultimo.code).replace(/\D/g, '')) + 1 : 1
    return `${prefijo}-${String(numero).padStart(5, '0')}`
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
