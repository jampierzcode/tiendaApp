import type Business from '#models/business'
import Customer from '#models/customer'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import OrderItemModifier from '#models/order_item_modifier'
import ModifierOption from '#models/modifier_option'
import ProductModifierGroup from '#models/product_modifier_group'
import NotificationService from '#services/notification_service'
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
  deliveryMethod?: 'envio' | 'recojo' | 'mesa'
  tableLabel?: string | null
  deliveryAddress?: string | null
  deliveryCity?: string | null
  note?: string | null
  items: LineaCarrito[]
}

export interface LineaMenu {
  productId: number
  quantity: number
  note?: string | null
  options?: { optionId: number; quantity?: number }[]
}

export interface DatosPedidoMenu extends Omit<DatosPedido, 'items'> {
  items: LineaMenu[]
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

    const metodo = (datos.deliveryMethod === 'mesa' ? 'recojo' : datos.deliveryMethod) ?? 'envio'

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
   * Pedido de un restaurante: líneas por plato, con modificadores.
   *
   * Cada línea es independiente (dos hamburguesas con distinta carne no se
   * agrupan) y el precio se recalcula aquí con lo que hay en la base: lo que
   * mande el navegador solo dice QUÉ se eligió, nunca cuánto cuesta.
   */
  static async crearDesdeMenu(business: Business, datos: DatosPedidoMenu) {
    if (!datos.items?.length) throw new OrderError('El carrito está vacío')

    if (!datos.customerName?.trim() || !datos.customerPhone?.trim()) {
      throw new OrderError('Faltan el nombre y el teléfono del cliente')
    }

    const metodo = datos.deliveryMethod ?? 'recojo'

    if (metodo === 'envio' && !datos.deliveryAddress?.trim()) {
      throw new OrderError('Falta la dirección de entrega')
    }
    if (metodo === 'mesa' && !datos.tableLabel?.trim()) {
      throw new OrderError('Falta indicar la mesa')
    }

    const productIds = [...new Set(datos.items.map((i) => Number(i.productId)))]

    const products = await Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .whereIn('id', productIds)
      .preload('discounts')
      .preload('defaultVariation')

    if (products.length !== productIds.length) {
      throw new OrderError('Alguno de los platos ya no está disponible')
    }
    const productoPorId = new Map(products.map((p) => [p.id, p]))

    const reglas = await ProductModifierGroup.query()
      .where('business_id', business.id)
      .whereIn('product_id', productIds)
      .preload('group')
    const reglasPorProducto = new Map<number, ProductModifierGroup[]>()
    for (const regla of reglas) {
      if (!regla.group?.isActive) continue
      const lista = reglasPorProducto.get(regla.productId) ?? []
      lista.push(regla)
      reglasPorProducto.set(regla.productId, lista)
    }

    const opcionIds = datos.items.flatMap((i) => (i.options ?? []).map((o) => Number(o.optionId)))
    const opciones = opcionIds.length
      ? await ModifierOption.query()
          .where('business_id', business.id)
          .andWhere('is_active', true)
          .whereIn('id', opcionIds)
      : []
    const opcionPorId = new Map(opciones.map((o) => [o.id, o]))

    // Se valida y se calcula todo antes de escribir.
    const lineas = datos.items.map((item) => {
      const cantidad = Math.floor(Number(item.quantity))
      if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 99) {
        throw new OrderError('Las cantidades deben ser enteros entre 1 y 99')
      }

      const producto = productoPorId.get(Number(item.productId))!
      const reglasDelPlato = reglasPorProducto.get(producto.id) ?? []
      const elegidas = new Map<number, number>() // optionId -> cantidad

      for (const o of item.options ?? []) {
        const q = Math.max(1, Math.floor(Number(o.quantity ?? 1)))
        elegidas.set(Number(o.optionId), (elegidas.get(Number(o.optionId)) ?? 0) + q)
      }

      const modificadores: { option: ModifierOption; groupName: string; quantity: number }[] = []
      let extras = 0

      for (const regla of reglasDelPlato) {
        let totalGrupo = 0
        for (const [optionId, q] of elegidas) {
          const opcion = opcionPorId.get(optionId)
          if (opcion && opcion.modifierGroupId === regla.modifierGroupId) {
            totalGrupo += q
            modificadores.push({ option: opcion, groupName: regla.group.name, quantity: q })
            extras += Number(opcion.priceDelta) * q
          }
        }
        if (totalGrupo < regla.minSelect) {
          throw new OrderError(`En «${producto.name}» elige: ${regla.group.name}`)
        }
        if (totalGrupo > regla.maxSelect) {
          throw new OrderError(
            `En «${producto.name}» puedes elegir hasta ${regla.maxSelect} en ${regla.group.name}`
          )
        }
      }

      const asignadas = modificadores.reduce((t, m) => t + m.quantity, 0)
      const pedidas = [...elegidas.values()].reduce((t, q) => t + q, 0)
      if (asignadas !== pedidas) {
        throw new OrderError(`Una opción elegida en «${producto.name}» ya no está disponible`)
      }

      const precio = PricingService.calcular(Number(producto.price), producto.discounts)
      const unitario = PricingService.redondear(Math.max(0, precio.final + extras))

      return { item, cantidad, producto, modificadores, precio, extras, unitario }
    })

    const order = await db.transaction(async (trx) => {
      const customer = await this.registrarCliente(business, datos as any, trx)

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
          tableLabel: metodo === 'mesa' ? datos.tableLabel!.trim() : null,
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

      for (const l of lineas) {
        const lineTotal = PricingService.redondear(l.unitario * l.cantidad)
        subtotal += PricingService.redondear((l.precio.original + l.extras) * l.cantidad)
        descuentoTotal += PricingService.redondear(l.precio.ahorro * l.cantidad)

        const linea = await OrderItem.create(
          {
            businessId: business.id,
            orderId: creado.id,
            productId: l.producto.id,
            productVariationId: l.producto.defaultVariation?.id ?? null,
            productName: l.producto.name,
            sku: l.producto.sku,
            variationLabel: null,
            unitPrice: l.unitario,
            unitCost: l.producto.cost,
            discountPercentage: l.precio.descuento,
            quantity: l.cantidad,
            lineTotal,
            note: l.item.note?.trim().slice(0, 255) || null,
          },
          { client: trx }
        )

        for (const m of l.modificadores) {
          await OrderItemModifier.create(
            {
              businessId: business.id,
              orderItemId: linea.id,
              modifierOptionId: m.option.id,
              groupName: m.groupName,
              optionName: m.option.name,
              priceDelta: Number(m.option.priceDelta),
              quantity: m.quantity,
            },
            { client: trx }
          )
        }
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

    await order.load('items', (q) => q.preload('modifiers'))
    await NotificationService.notificar(business, order, 'recibido')

    return { order, whatsappUrl: this.construirUrlWhatsapp(business, order) }
  }

  /**
   * El stock NO se descuenta al crear el pedido: un pedido de WhatsApp aún
   * no está confirmado y reservar inventario por cada carrito abandonado
   * dejaría la tienda en cero. Se descuenta cuando el negocio lo confirma.
   */
  private static calcularEnvio(business: Business, montoNeto: number, metodo: string): number {
    if (metodo === 'recojo' || metodo === 'mesa') return 0

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
        const partes = [
          item.variationLabel,
          ...(item.modifiers ?? []).map((m) =>
            m.quantity > 1 ? `${m.quantity}× ${m.optionName}` : m.optionName
          ),
        ].filter(Boolean)
        const etiqueta = partes.length ? ` (${partes.join(', ')})` : ''
        const nota = item.note ? `\n   📝 ${item.note}` : ''
        return `• ${item.quantity} × ${item.productName}${etiqueta} — ${dinero(item.lineTotal)}${nota}`
      })
      .join('\n')

    const entrega =
      order.deliveryMethod === 'mesa'
        ? `En mesa ${order.tableLabel ?? ''}`.trim()
        : order.deliveryMethod === 'recojo'
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
