import type Business from '#models/business'
import Customer from '#models/customer'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import PricingService from '#services/pricing_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export class OrderError extends Error {}

export interface LineaCarrito {
  variationId: number
  quantity: number
}

export interface DatosPedido {
  customerName: string
  customerPhone: string
  deliveryMethod?: 'envio' | 'recojo'
  deliveryAddress?: string | null
  deliveryCity?: string | null
  note?: string | null
  items: LineaCarrito[]
}

const PLANTILLA_POR_DEFECTO = `Hola {{tienda}} 👋
Quiero hacer este pedido:

{{productos}}

Total: {{total}}
Entrega: {{entrega}}
Mi nombre: {{cliente}}
Pedido: {{codigo}}`

/**
 * Creación de pedidos desde la tienda pública.
 *
 * El pedido se guarda en la base ANTES de abrir WhatsApp. Es la diferencia
 * entre tener el dato y no tenerlo: si el cliente arma el carrito y no llega
 * a enviar el mensaje, el negocio igual ve el pedido y puede llamarlo.
 */
export default class OrderService {
  static async crearDesdeTienda(business: Business, datos: DatosPedido) {
    if (!datos.items?.length) {
      throw new OrderError('El carrito está vacío')
    }

    if (!datos.customerName?.trim() || !datos.customerPhone?.trim()) {
      throw new OrderError('Faltan el nombre y el teléfono del cliente')
    }

    const metodo = datos.deliveryMethod ?? 'envio'

    if (metodo === 'envio' && !datos.deliveryAddress?.trim()) {
      throw new OrderError('Falta la dirección de entrega')
    }

    // Se agrupan las líneas repetidas para no crear dos veces la misma.
    const cantidades = new Map<number, number>()
    for (const item of datos.items) {
      const cantidad = Math.floor(Number(item.quantity))
      if (!Number.isFinite(cantidad) || cantidad < 1) {
        throw new OrderError('Las cantidades deben ser números enteros positivos')
      }
      cantidades.set(item.variationId, (cantidades.get(item.variationId) ?? 0) + cantidad)
    }

    const variationIds = [...cantidades.keys()]

    const variations = await ProductVariation.query()
      .where('business_id', business.id)
      .whereIn('id', variationIds)
      .preload('attributes', (a) => a.preload('value', (v) => v.preload('attribute')))

    if (variations.length !== variationIds.length) {
      throw new OrderError('Alguno de los productos ya no está disponible')
    }

    const products = await Product.query()
      .where('business_id', business.id)
      .whereIn(
        'id',
        variations.map((v) => v.productId)
      )
      .preload('discounts')

    const productoPorId = new Map(products.map((p) => [p.id, p]))

    // Se comprueba el stock antes de escribir nada, para poder avisar de
    // todo lo que falta de una sola vez en vez de fallar en la primera línea.
    const faltantes: string[] = []
    for (const variation of variations) {
      const pedida = cantidades.get(variation.id)!
      if (variation.stock < pedida) {
        const producto = productoPorId.get(variation.productId)
        faltantes.push(
          `${producto?.name ?? 'Producto'} ${this.etiquetaVariacion(variation)}`.trim() +
            ` (quedan ${variation.stock})`
        )
      }
    }

    if (faltantes.length) {
      throw new OrderError(`Sin stock suficiente: ${faltantes.join(', ')}`)
    }

    const order = await db.transaction(async (trx) => {
      const customer = await this.registrarCliente(business, datos, trx)

      const creado = await Order.create(
        {
          businessId: business.id,
          code: await this.siguienteCodigo(business, trx),
          customerId: customer.id,
          channel: 'whatsapp',
          status: 'pendiente',
          customerName: datos.customerName.trim(),
          customerPhone: datos.customerPhone.trim(),
          deliveryMethod: metodo,
          deliveryAddress: datos.deliveryAddress?.trim() || null,
          deliveryCity: datos.deliveryCity?.trim() || null,
          note: datos.note?.trim() || null,
          currency: business.currency,
          subtotal: 0,
          discountTotal: 0,
          shippingCost: 0,
          total: 0,
          paidTotal: 0,
        },
        { client: trx }
      )

      let subtotal = 0
      let descuentoTotal = 0

      for (const variation of variations) {
        const cantidad = cantidades.get(variation.id)!
        const producto = productoPorId.get(variation.productId)!
        const precioLista = Number(variation.price)
        const precio = PricingService.calcular(precioLista, producto.discounts)

        const lineTotal = PricingService.redondear(precio.final * cantidad)
        subtotal += PricingService.redondear(precio.original * cantidad)
        descuentoTotal += PricingService.redondear(precio.ahorro * cantidad)

        await OrderItem.create(
          {
            businessId: business.id,
            orderId: creado.id,
            productId: producto.id,
            productVariationId: variation.id,
            productName: producto.name,
            sku: variation.sku ?? producto.sku,
            variationLabel: this.etiquetaVariacion(variation),
            unitPrice: precio.final,
            unitCost: producto.cost,
            discountPercentage: precio.descuento,
            quantity: cantidad,
            lineTotal,
          },
          { client: trx }
        )
      }

      const envio = this.calcularEnvio(business, subtotal - descuentoTotal, metodo)

      creado.subtotal = PricingService.redondear(subtotal)
      creado.discountTotal = PricingService.redondear(descuentoTotal)
      creado.shippingCost = envio
      creado.total = PricingService.redondear(subtotal - descuentoTotal + envio)

      creado.useTransaction(trx)
      await creado.save()

      return creado
    })

    await order.load('items')

    return {
      order,
      whatsappUrl: this.construirUrlWhatsapp(business, order),
    }
  }

  /**
   * El stock NO se descuenta al crear el pedido: un pedido de WhatsApp aún
   * no está confirmado y reservar inventario por cada carrito abandonado
   * dejaría la tienda en cero. Se descuenta cuando el negocio lo confirma.
   */
  private static calcularEnvio(business: Business, montoNeto: number, metodo: string): number {
    if (metodo === 'recojo') return 0

    const gratisDesde = business.freeShippingFrom
    if (gratisDesde !== null && gratisDesde !== undefined && montoNeto >= Number(gratisDesde)) {
      return 0
    }

    return PricingService.redondear(Number(business.shippingCost ?? 0))
  }

  private static async registrarCliente(business: Business, datos: DatosPedido, trx: any) {
    const phone = datos.customerPhone.trim()

    const existente = await Customer.query({ client: trx })
      .where('business_id', business.id)
      .andWhere('phone', phone)
      .first()

    if (existente) {
      existente.merge({
        name: datos.customerName.trim(),
        address: datos.deliveryAddress?.trim() || existente.address,
        city: datos.deliveryCity?.trim() || existente.city,
      })
      existente.useTransaction(trx)
      await existente.save()
      return existente
    }

    return Customer.create(
      {
        businessId: business.id,
        name: datos.customerName.trim(),
        phone,
        address: datos.deliveryAddress?.trim() || null,
        city: datos.deliveryCity?.trim() || null,
      },
      { client: trx }
    )
  }

  /** Código legible y corto: P-000123, correlativo por tienda. */
  private static async siguienteCodigo(business: Business, trx: any): Promise<string> {
    const ultimo = await trx
      .from('orders')
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .select('code')
      .first()

    const numero = ultimo?.code ? Number(String(ultimo.code).replace(/\D/g, '')) + 1 : 1

    return `P-${String(numero).padStart(6, '0')}`
  }

  static etiquetaVariacion(variation: ProductVariation): string {
    if (variation.isDefault) return ''

    const partes = (variation.attributes ?? [])
      .map((attr) => {
        const nombre = attr.value?.attribute?.name
        const valor = attr.value?.value
        return nombre && valor ? `${nombre} ${valor}` : valor
      })
      .filter(Boolean)

    return partes.join(' · ')
  }

  /**
   * Arma el enlace de WhatsApp con el pedido ya escrito.
   */
  static construirUrlWhatsapp(business: Business, order: Order): string | null {
    if (!business.whatsappPhone) return null

    const simbolo = business.currencySymbol || 'S/'
    const dinero = (valor: number) => `${simbolo} ${Number(valor).toFixed(2)}`

    const productos = (order.items ?? [])
      .map((item) => {
        const etiqueta = item.variationLabel ? ` (${item.variationLabel})` : ''
        return `• ${item.quantity} × ${item.productName}${etiqueta} — ${dinero(item.lineTotal)}`
      })
      .join('\n')

    const entrega =
      order.deliveryMethod === 'recojo'
        ? 'Recojo en tienda'
        : `Envío a ${[order.deliveryAddress, order.deliveryCity].filter(Boolean).join(', ')}`

    const plantilla = business.whatsappMessageTemplate?.trim() || PLANTILLA_POR_DEFECTO

    const mensaje = plantilla
      .replaceAll('{{tienda}}', business.name)
      .replaceAll('{{codigo}}', order.code)
      .replaceAll('{{cliente}}', order.customerName)
      .replaceAll('{{telefono}}', order.customerPhone ?? '')
      .replaceAll('{{productos}}', productos)
      .replaceAll('{{subtotal}}', dinero(order.subtotal))
      .replaceAll('{{envio}}', dinero(order.shippingCost))
      .replaceAll('{{total}}', dinero(order.total))
      .replaceAll('{{entrega}}', entrega)
      .replaceAll('{{nota}}', order.note ?? '')

    const telefono = business.whatsappPhone.replace(/\D/g, '')

    return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`
  }

  /** Marca que el cliente sí llegó a abrir WhatsApp con el pedido. */
  static async marcarEnviadoPorWhatsapp(order: Order) {
    order.whatsappSentAt = DateTime.now()
    await order.save()
    return order
  }
}
