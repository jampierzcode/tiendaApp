import Business from '#models/business'
import Category from '#models/category'
import Order from '#models/order'
import Product from '#models/product'
import ProductAttribute from '#models/product_attribute'
import OrderService, { OrderError } from '#services/order_service'
import PricingService from '#services/pricing_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Tienda pública. Sin token: es lo que abre el cliente al escanear el QR.
 *
 * Todo lo que sale de aquí está filtrado a mano: nada de `serialize()` del
 * modelo entero, porque `businesses` y `products` guardan también el costo,
 * el dueño y los productos inactivos.
 */
export default class StorefrontController {
  private async tiendaPublica(slug: string) {
    return Business.query()
      .where('slug', slug)
      .andWhere('is_public', true)
      .andWhere('status', 'activo')
      .preload('bannerImage')
      .first()
  }

  /** Datos de la tienda: identidad, contacto y colores. */
  public async show({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    return {
      status: 'success',
      data: {
        slug: business.slug,
        name: business.name,
        description: business.description,
        logoUrl: business.logoUrl,
        bannerUrl: business.bannerImage?.url ?? null,
        primaryColor: business.primaryColor,
        secondaryColor: business.secondaryColor,
        currency: business.currency,
        currencySymbol: business.currencySymbol,
        shippingCost: Number(business.shippingCost),
        freeShippingFrom:
          business.freeShippingFrom === null ? null : Number(business.freeShippingFrom),
        aceptaPedidos: business.puedeVender,
        phone: business.phone,
        address: business.address,
        city: business.city,
        schedule: business.schedule,
        instagram: business.instagram,
        facebook: business.facebook,
        tiktok: business.tiktok,
      },
    }
  }

  /** Categorías con subcategorías, para el menú de la tienda. */
  public async categories({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const categories = await Category.query()
      .where('business_id', business.id)
      .preload('subcategories')
      .orderBy('name', 'asc')

    return {
      status: 'success',
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        imageUrl: c.imageUrl,
        subcategories: c.subcategories.map((s) => ({ id: s.id, name: s.name, slug: s.slug })),
      })),
    }
  }

  /** Atributos filtrables (talla, color) con sus valores disponibles. */
  public async filters({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const attributes = await ProductAttribute.query()
      .where('business_id', business.id)
      .andWhere('is_filterable', true)
      .preload('values')

    return {
      status: 'success',
      data: attributes.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        values: a.values.map((v) => ({ id: v.id, value: v.value, hexColor: v.hexColor })),
      })),
    }
  }

  /** Catálogo con filtros, orden y paginación. */
  public async products({ params, request, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const page = Math.max(1, Number(request.input('page', 1)))
    const perPage = Math.min(48, Math.max(1, Number(request.input('perPage', 12))))
    const search = request.input('search')
    const categorySlug = request.input('category')
    const subcategorySlug = request.input('subcategory')
    const tagSlug = request.input('tag')
    const minPrice = request.input('minPrice')
    const maxPrice = request.input('maxPrice')
    const sort = request.input('sort', 'recientes')
    const valueIds = this.comoLista(request.input('attributeValues'))

    const query = Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .preload('businessImages')
      .preload('discounts')
      .preload('tags')
      .preload('variations', (v) => {
        v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      })

    if (search) {
      query.whereILike('name', `%${search}%`)
    }

    if (categorySlug) {
      query.whereHas('categoryLinks', (link) => {
        link.whereHas('category', (c) => c.where('slug', categorySlug))
      })
    }

    if (subcategorySlug) {
      query.whereHas('categoryLinks', (link) => {
        link.whereHas('subcategory', (s) => s.where('slug', subcategorySlug))
      })
    }

    if (tagSlug) {
      query.whereHas('tags', (t) => t.where('tags.slug', tagSlug))
    }

    if (minPrice) query.where('price', '>=', Number(minPrice))
    if (maxPrice) query.where('price', '<=', Number(maxPrice))

    // Un producto entra si ALGUNA de sus variaciones tiene el valor pedido:
    // quien filtra por "talla M" quiere ver el polo, no descartarlo porque
    // también existe en S.
    if (valueIds.length) {
      query.whereHas('variations', (v) => {
        v.whereHas('attributes', (a) => a.whereIn('attribute_value_id', valueIds))
      })
    }

    const orden: Record<string, [string, 'asc' | 'desc']> = {
      recientes: ['id', 'desc'],
      'precio-asc': ['price', 'asc'],
      'precio-desc': ['price', 'desc'],
      nombre: ['name', 'asc'],
    }
    const [columna, direccion] = orden[sort] ?? orden.recientes
    query.orderBy(columna, direccion)

    const paginados = await query.paginate(page, perPage)

    return {
      status: 'success',
      meta: paginados.getMeta(),
      data: paginados.all().map((p) => this.resumenProducto(p, business)),
    }
  }

  /** Ficha del producto, con sus variaciones y stock real. */
  public async product({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const product = await Product.query()
      .where('business_id', business.id)
      .andWhere('slug', params.productSlug)
      .andWhere('status', 'activo')
      .preload('businessImages')
      .preload('discounts')
      .preload('tags')
      .preload('variations', (v) => {
        v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
        v.preload('businessImage')
      })
      .first()

    if (!product) {
      return response.notFound({ status: 'error', message: 'Producto no encontrado' })
    }

    const precio = PricingService.calcular(product.price, product.discounts)

    return {
      status: 'success',
      data: {
        ...this.resumenProducto(product, business),
        description: product.description,
        variations: product.variations.map((v) => {
          const precioVariacion = PricingService.calcular(
            Number(v.price),
            product.discounts
          )

          return {
            id: v.id,
            sku: v.sku,
            isDefault: v.isDefault,
            stock: v.stock,
            disponible: v.stock > 0,
            // Si la variación no tiene foto propia, la tienda cae en la del
            // producto: así el beige y el negro se ven distintos, pero la S y
            // la M del mismo color no obligan a subir la misma foto dos veces.
            imageUrl: v.businessImage?.url ?? null,
            price: precioVariacion.final,
            originalPrice: precioVariacion.descuento > 0 ? precioVariacion.original : null,
            label: OrderService.etiquetaVariacion(v),
            attributes: v.attributes.map((a) => ({
              attributeId: a.value?.attributeId,
              attributeName: a.value?.attribute?.name,
              valueId: a.attributeValueId,
              value: a.value?.value,
              hexColor: a.value?.hexColor,
            })),
          }
        }),
        precio,
      },
    }
  }

  /**
   * Crea el pedido y devuelve el enlace de WhatsApp ya armado.
   *
   * Se guarda primero y se manda a WhatsApp después: así el negocio ve el
   * pedido aunque el cliente nunca llegue a enviar el mensaje.
   */
  public async createOrder({ params, request, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    if (!business.puedeVender) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Esta tienda no está recibiendo pedidos por ahora',
      })
    }

    const datos = request.only([
      'customerName',
      'customerPhone',
      'deliveryMethod',
      'deliveryAddress',
      'deliveryCity',
      'note',
      'items',
    ])

    try {
      const { order, whatsappUrl } = await OrderService.crearDesdeTienda(business, datos as any)

      return response.created({
        status: 'success',
        message: 'Pedido registrado',
        data: {
          code: order.code,
          total: Number(order.total),
          subtotal: Number(order.subtotal),
          discountTotal: Number(order.discountTotal),
          shippingCost: Number(order.shippingCost),
          currencySymbol: business.currencySymbol,
          whatsappUrl,
        },
      })
    } catch (error) {
      if (error instanceof OrderError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** El cliente confirma que abrió WhatsApp: sirve para medir conversión. */
  public async markOrderSent({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('code', params.code)
      .first()

    if (!order) {
      return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    }

    await OrderService.marcarEnviadoPorWhatsapp(order)

    return { status: 'success' }
  }

  // --- helpers ---

  private comoLista(valor: unknown): number[] {
    if (!valor) return []
    const bruto = Array.isArray(valor) ? valor : String(valor).split(',')
    return bruto.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
  }

  private resumenProducto(product: Product, business: Business) {
    const precio = PricingService.calcular(product.price, product.discounts)
    const stockTotal = (product.variations ?? []).reduce((total, v) => total + v.stock, 0)

    // Colores disponibles: es el dato que más se mira en una grilla de ropa.
    const colores = new Map<number, { value: string; hexColor: string | null }>()
    for (const variation of product.variations ?? []) {
      for (const attr of variation.attributes ?? []) {
        if (attr.value?.hexColor) {
          colores.set(attr.attributeValueId, {
            value: attr.value.value,
            hexColor: attr.value.hexColor,
          })
        }
      }
    }

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      imageUrl: product.businessImages?.url ?? null,
      price: precio.final,
      originalPrice: precio.descuento > 0 ? precio.original : null,
      discount: precio.descuento,
      currencySymbol: business.currencySymbol,
      stock: stockTotal,
      disponible: stockTotal > 0,
      tags: (product.tags ?? []).map((t) => ({ name: t.name, slug: t.slug, color: t.color })),
      colores: [...colores.values()],
    }
  }
}
