import Business from '#models/business'
import Category from '#models/category'
import Order from '#models/order'
import ProductModifierGroup from '#models/product_modifier_group'
import Product from '#models/product'
import ProductAttribute from '#models/product_attribute'
import OrderService, { OrderError } from '#services/order_service'
import PricingService from '#services/pricing_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

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
        businessType: business.businessType,
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
        whatsappPhone: business.whatsappPhone,
        address: business.address,
        city: business.city,
        schedule: business.schedule,
        instagram: business.instagram,
        facebook: business.facebook,
        tiktok: business.tiktok,
      },
    }
  }


  /**
   * Menú digital: platos agrupados por categoría, cada uno con sus grupos de
   * modificadores y reglas. Una sola llamada para pintar toda la carta.
   */
  public async menu({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const products = await Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .preload('businessImages')
      .preload('discounts')
      .preload('tags')
      .preload('defaultVariation')
      .preload('categoryLinks', (l) => l.preload('category'))
      .orderBy('name', 'asc')

    const reglas = await ProductModifierGroup.query()
      .where('business_id', business.id)
      .preload('group', (g) =>
        g.where('is_active', true).preload('options', (o) =>
          o.where('is_active', true).orderBy('sort_order', 'asc')
        )
      )
      .orderBy('sort_order', 'asc')

    const gruposPorProducto = new Map<number, any[]>()
    for (const r of reglas) {
      if (!r.group) continue
      const lista = gruposPorProducto.get(r.productId) ?? []
      lista.push({
        groupId: r.group.id,
        name: r.group.name,
        description: r.group.description,
        minSelect: r.minSelect,
        maxSelect: r.maxSelect,
        required: r.minSelect > 0,
        options: r.group.options.map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: Number(o.priceDelta),
        })),
      })
      gruposPorProducto.set(r.productId, lista)
    }

    const categorias = await Category.query()
      .where('business_id', business.id)
      .orderBy('name', 'asc')

    const platos = products.map((p) => {
      const precio = PricingService.calcular(p.price, p.discounts)
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        imageUrl: p.businessImages?.url ?? null,
        price: precio.final,
        originalPrice: precio.descuento > 0 ? precio.original : null,
        categoryIds: p.categoryLinks.map((l) => l.categoryId),
        tags: p.tags.map((t) => ({ name: t.name, color: t.color })),
        modifierGroups: gruposPorProducto.get(p.id) ?? [],
      }
    })

    return {
      status: 'success',
      data: {
        categories: categorias
          .map((c) => ({ id: c.id, name: c.name, slug: c.slug, imageUrl: c.imageUrl }))
          .filter((c) => platos.some((p) => p.categoryIds.includes(c.id))),
        products: platos,
      },
    }
  }

  /**
   * Seguimiento público del pedido. Solo devuelve estado y platos: nada de
   * teléfono ni dirección, porque el código es correlativo y adivinable.
   */
  public async orderTracking({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('code', params.code)
      .preload('items', (i) => i.preload('modifiers'))
      .first()

    if (!order) {
      return response.notFound({ status: 'error', message: 'Pedido no encontrado' })
    }

    return {
      status: 'success',
      data: {
        code: order.code,
        status: order.status,
        deliveryMethod: order.deliveryMethod,
        tableLabel: order.tableLabel,
        total: Number(order.total),
        currencySymbol: business.currencySymbol,
        createdAt: order.createdAt,
        items: order.items.map((i) => ({
          name: i.productName,
          quantity: i.quantity,
          lineTotal: Number(i.lineTotal),
          modifiers: i.modifiers.map((m) => m.optionName),
          note: i.note,
        })),
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

  /**
   * Aplica a una consulta de productos los filtros del catálogo. `omitir`
   * deja fuera algunos: para contar cuántos productos tiene cada valor de un
   * filtro hay que ignorar el propio filtro, si no el resto se vería en 0.
   */
  private async filtrar(
    query: ModelQueryBuilderContract<typeof Product, Product>,
    businessId: number,
    request: HttpContext['request'],
    omitir: ('categoria' | 'etiqueta' | 'atributos')[] = []
  ) {
    const search = String(request.input('search') ?? '').trim()
    const categorySlug = request.input('category')
    const subcategorySlug = request.input('subcategory')
    const tagSlug = request.input('tag')
    const minPrice = request.input('minPrice')
    const maxPrice = request.input('maxPrice')
    const valueIds = this.comoLista(request.input('attributeValues'))

    // Cada palabra tiene que aparecer en el nombre, el SKU o la descripción
    // (donde viven la referencia OEM y la aplicación): "bobina accent" y
    // "27301-03200" encuentran lo mismo que escribiría un mecánico.
    for (const palabra of search.split(/\s+/).filter(Boolean).slice(0, 6)) {
      const like = `%${palabra}%`
      query.where((q) => {
        q.whereILike('name', like).orWhereILike('sku', like).orWhereILike('description', like)
      })
    }

    if (!omitir.includes('categoria')) {
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
    }

    if (tagSlug && !omitir.includes('etiqueta')) {
      query.whereHas('tags', (t) => t.where('tags.slug', tagSlug))
    }

    if (minPrice) query.where('price', '>=', Number(minPrice))
    if (maxPrice) query.where('price', '<=', Number(maxPrice))

    // Dentro de un mismo atributo los valores suman (Toyota O Nissan); entre
    // atributos se exigen todos (marca NDC Y medida 0.25).
    if (valueIds.length && !omitir.includes('atributos')) {
      const filas = await db
        .from('product_attribute_values')
        .where('business_id', businessId)
        .whereIn('id', valueIds)
        .select('id', 'attribute_id')

      const porAtributo = new Map<number, number[]>()
      for (const f of filas) {
        porAtributo.set(f.attribute_id, [...(porAtributo.get(f.attribute_id) ?? []), f.id])
      }
      for (const ids of porAtributo.values()) {
        query.whereHas('variations', (v) => {
          v.whereHas('attributes', (a) => a.whereIn('attribute_value_id', ids))
        })
      }
    }
  }

  private async idsDelCatalogo(
    business: Business,
    request: HttpContext['request'],
    omitir: ('categoria' | 'etiqueta' | 'atributos')[] = []
  ) {
    const query = Product.query().where('business_id', business.id).andWhere('status', 'activo')
    await this.filtrar(query, business.id, request, omitir)
    const filas = await query.select('id')
    return filas.map((p) => p.id)
  }

  /**
   * Lo que el cliente puede filtrar, con cuántos productos hay detrás de cada
   * opción dado lo que ya eligió. Una opción en 0 no se muestra: es lo que
   * evita el «no encontramos nada» después de hacer clic.
   */
  public async facets({ params, request, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    // Categorías: cuentan sobre lo buscado, sin importar la categoría elegida.
    const idsCategorias = await this.idsDelCatalogo(business, request, ['categoria', 'etiqueta', 'atributos'])
    const idsAtributos = await this.idsDelCatalogo(business, request, ['atributos'])
    const idsEtiquetas = await this.idsDelCatalogo(business, request, ['etiqueta'])

    const [porCategoria, porSubcategoria, categorias] = await Promise.all([
      db
        .from('category_product')
        .whereIn('product_id', idsCategorias.length ? idsCategorias : [0])
        .groupBy('category_id')
        .select('category_id')
        .countDistinct('product_id as total'),
      db
        .from('category_product')
        .whereIn('product_id', idsCategorias.length ? idsCategorias : [0])
        .whereNotNull('subcategory_id')
        .groupBy('subcategory_id')
        .select('subcategory_id')
        .countDistinct('product_id as total'),
      Category.query()
        .where('business_id', business.id)
        .preload('subcategories')
        .orderBy('name', 'asc'),
    ])
    const totCat = new Map(porCategoria.map((r: any) => [r.category_id, Number(r.total)]))
    const totSub = new Map(porSubcategoria.map((r: any) => [r.subcategory_id, Number(r.total)]))

    const filasAtributos = await db
      .from('product_variation_attributes as pva')
      .join('product_variations as v', 'v.id', 'pva.variation_id')
      .join('product_attribute_values as av', 'av.id', 'pva.attribute_value_id')
      .join('product_attributes as a', 'a.id', 'av.attribute_id')
      .where('a.business_id', business.id)
      .andWhere('a.is_filterable', true)
      .whereIn('v.product_id', idsAtributos.length ? idsAtributos : [0])
      .groupBy('a.id', 'a.name', 'a.type', 'av.id', 'av.value', 'av.hex_color')
      .select('a.id as attr_id', 'a.name as attr_name', 'a.type as attr_type', 'av.id as value_id', 'av.value', 'av.hex_color')
      .countDistinct('v.product_id as total')
      .orderBy('a.id')
      .orderBy('av.value')

    const atributos = new Map<number, any>()
    for (const f of filasAtributos as any[]) {
      if (!atributos.has(f.attr_id)) {
        atributos.set(f.attr_id, { id: f.attr_id, name: f.attr_name, type: f.attr_type, values: [] })
      }
      atributos.get(f.attr_id).values.push({
        id: f.value_id,
        value: f.value,
        hexColor: f.hex_color,
        count: Number(f.total),
      })
    }

    const filasEtiquetas = await db
      .from('product_tag as pt')
      .join('tags as t', 't.id', 'pt.tag_id')
      .where('t.business_id', business.id)
      .whereIn('pt.product_id', idsEtiquetas.length ? idsEtiquetas : [0])
      .groupBy('t.id', 't.name', 't.slug', 't.color')
      .select('t.name', 't.slug', 't.color')
      .countDistinct('pt.product_id as total')
      .orderByRaw('count(distinct pt.product_id) desc')
      .orderBy('t.name')
      .limit(40)

    return {
      status: 'success',
      data: {
        categories: categorias
          .map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            count: totCat.get(c.id) ?? 0,
            subcategories: c.subcategories
              .map((s) => ({ id: s.id, name: s.name, slug: s.slug, count: totSub.get(s.id) ?? 0 }))
              .filter((s) => s.count > 0),
          }))
          .filter((c) => c.count > 0),
        attributes: [...atributos.values()],
        tags: (filasEtiquetas as any[]).map((t) => ({
          name: t.name,
          slug: t.slug,
          color: t.color,
          count: Number(t.total),
        })),
      },
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
    const sort = request.input('sort', 'recientes')

    const query = Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .preload('businessImages')
      .preload('discounts')
      .preload('tags')
      .preload('categoryLinks', (l) => l.preload('category').preload('subcategory'))
      .preload('variations', (v) => {
        v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      })

    await this.filtrar(query, business.id, request)

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

  /**
   * Productos parecidos: primero los de su misma subcategoría, luego los de
   * su categoría. Es lo que mantiene al cliente comparando en vez de volver
   * atrás.
   */
  public async related({ params, response }: HttpContext) {
    const business = await this.tiendaPublica(params.slug)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Tienda no encontrada' })
    }

    const actual = await Product.query()
      .where('business_id', business.id)
      .andWhere('slug', params.productSlug)
      .preload('categoryLinks')
      .first()

    if (!actual) {
      return response.notFound({ status: 'error', message: 'Producto no encontrado' })
    }

    const subIds = actual.categoryLinks.map((l) => l.subcategoryId).filter((v): v is number => !!v)
    const catIds = actual.categoryLinks.map((l) => l.categoryId)
    const limite = 8
    const elegidos: Product[] = []

    const cargar = async (columna: 'subcategory_id' | 'category_id', ids: number[]) => {
      if (!ids.length || elegidos.length >= limite) return
      const excluir = [actual.id, ...elegidos.map((p) => p.id)]
      const filas = await Product.query()
        .where('business_id', business.id)
        .andWhere('status', 'activo')
        .whereNotIn('id', excluir)
        .whereHas('categoryLinks', (l) => l.whereIn(columna, ids))
        .preload('businessImages')
        .preload('discounts')
        .preload('tags')
        .preload('categoryLinks', (l) => l.preload('category').preload('subcategory'))
        .preload('variations', (v) => {
          v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
        })
        // Primero los que tienen foto: una fila de «Sin foto» no invita a nada.
        .orderByRaw('(business_image_id is null) asc')
        .orderBy('id', 'desc')
        .limit(limite - elegidos.length)
      elegidos.push(...filas)
    }

    await cargar('subcategory_id', subIds)
    await cargar('category_id', catIds)

    return { status: 'success', data: elegidos.map((p) => this.resumenProducto(p, business)) }
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
      .preload('categoryLinks', (l) => l.preload('category').preload('subcategory'))
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
        categorias: product.categoryLinks.map((l) => ({
          category: { name: l.category.name, slug: l.category.slug },
          subcategory: l.subcategory
            ? { name: l.subcategory.name, slug: l.subcategory.slug }
            : null,
        })),
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
      'tableLabel',
      'note',
      'items',
    ])

    try {
      const { order, whatsappUrl } = business.esRestaurante
        ? await OrderService.crearDesdeMenu(business, datos as any)
        : await OrderService.crearDesdeTienda(business, datos as any)

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
      sku: product.sku,
      categoria:
        product.categoryLinks?.[0]?.subcategory?.name ?? product.categoryLinks?.[0]?.category?.name ?? null,
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
