import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import InventoryService from '#services/inventory_service'
import VariationService, { VariationError } from '#services/variation_service'
import SkuService from '#services/sku_service'
import SlugService from '#services/slug_service'
import Subcategory from '#models/subcategory'
import Tag from '#models/tag'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

type CategoryLinkInput = { categoryId: number; subcategoryId?: number | null }

/**
 * Productos del negocio abierto en el panel.
 *
 * El negocio llega en `ctx.business`, puesto por TenantMiddleware desde el
 * `:businessUuid` de la ruta. Ningún método vuelve a deducirlo del usuario.
 */
export default class ProductsController {
  /**
   * Reemplaza las categorías del producto por las pedidas. Un producto puede
   * estar en varias (Motor › Lubricación y Repuestos Sail, por ejemplo); cada
   * categoría y subcategoría tiene que ser de este negocio y la subcategoría,
   * hija de la categoría con la que viaja.
   */
  private static async syncCategories(
    trx: TransactionClientContract,
    businessId: number,
    productId: number,
    links: CategoryLinkInput[]
  ) {
    const clean = links
      .map((l) => ({
        categoryId: Number(l.categoryId),
        subcategoryId: l.subcategoryId ? Number(l.subcategoryId) : null,
      }))
      .filter((l) => l.categoryId)

    const categoryIds = [...new Set(clean.map((l) => l.categoryId))]
    const subIds = [...new Set(clean.map((l) => l.subcategoryId).filter((v): v is number => !!v))]

    const categories = categoryIds.length
      ? await Category.query({ client: trx }).where('business_id', businessId).whereIn('id', categoryIds)
      : []
    if (categories.length !== categoryIds.length) {
      throw new Error('Alguna categoría no pertenece a este negocio')
    }

    const subs = subIds.length
      ? await Subcategory.query({ client: trx }).where('business_id', businessId).whereIn('id', subIds)
      : []
    if (subs.length !== subIds.length) {
      throw new Error('Alguna subcategoría no pertenece a este negocio')
    }
    const parentOf = new Map(subs.map((s) => [s.id, s.categoryId]))
    for (const l of clean) {
      if (l.subcategoryId && parentOf.get(l.subcategoryId) !== l.categoryId) {
        throw new Error('Una subcategoría no corresponde a su categoría')
      }
    }

    await CategoryProduct.query({ client: trx }).where('product_id', productId).delete()

    const seen = new Set<string>()
    for (const l of clean) {
      const key = `${l.categoryId}:${l.subcategoryId ?? 0}`
      if (seen.has(key)) continue
      seen.add(key)
      await CategoryProduct.create({ businessId, productId, ...l }, { client: trx })
    }
  }

  private static async syncTags(
    trx: TransactionClientContract,
    businessId: number,
    product: Product,
    tagIds: number[]
  ) {
    const valid = tagIds.length
      ? await Tag.query({ client: trx }).where('business_id', businessId).whereIn('id', tagIds).select('id')
      : []
    product.useTransaction(trx)
    await product.related('tags').sync(
      Object.fromEntries(valid.map((t) => [t.id, { business_id: businessId }]))
    )
  }

  public async index({ business, request }: HttpContext) {
    const search = request.input('search')
    const status = request.input('status')
    const categoryId = request.input('categoryId')
    const subcategoryId = request.input('subcategoryId')

    const query = Product.query()
      .where('business_id', business.id)
      .preload('businessImages')
      .preload('tags')
      .preload('categoryLinks', (l) => l.preload('category').preload('subcategory'))
      .preload('variations', (v) => {
        v.orderBy('is_default', 'desc').preload('attributes', (a) =>
          a.preload('value', (val) => val.preload('attribute'))
        )
      })
      .orderBy('id', 'desc')

    // Orden pedido por el panel: alfabético o el manual (arrastrado).
    const orden = request.input('sort')
    if (orden === 'name_asc' || orden === 'name_desc') {
      query.clearOrder().orderBy('name', orden === 'name_asc' ? 'asc' : 'desc')
    } else if (orden === 'manual') {
      query.clearOrder().orderBy('sort_order', 'asc').orderBy('name', 'asc')
    }

    if (search) {
      query.where((sub) => {
        sub.whereILike('name', `%${search}%`).orWhereILike('sku', `%${search}%`)
      })
    }

    if (status) {
      query.where('status', status)
    }

    if (categoryId === 'none') {
      query.whereDoesntHave('categoryLinks', (link) => link)
    } else if (categoryId) {
      query.whereHas('categoryLinks', (link) => link.where('category_id', categoryId))
    }

    if (subcategoryId) {
      query.whereHas('categoryLinks', (link) => link.where('subcategory_id', subcategoryId))
    }

    // El panel pagina (con 2.500 productos no se puede mandar todo). Las
    // pantallas que piden la lista completa sin `page` siguen funcionando.
    if (request.input('page')) {
      const page = Math.max(1, Number(request.input('page', 1)))
      const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 10))))
      const paged = await query.paginate(page, perPage)
      return {
        status: 'success',
        data: paged.all(),
        meta: { total: paged.total, page: paged.currentPage, perPage: paged.perPage },
      }
    }

    const products = await query

    return { status: 'success', data: products }
  }

  /** Guarda el orden manual de los platos: el primer id queda primero. */
  public async reorder({ business, request, response }: HttpContext) {
    const ids: number[] = (request.input('ids') ?? []).map(Number).filter(Boolean)
    if (!ids.length) {
      return response.unprocessableEntity({ status: 'error', message: 'No hay nada que ordenar' })
    }
    await db.transaction(async (trx) => {
      for (const [i, id] of ids.entries()) {
        await trx
          .from('products')
          .where('business_id', business.id)
          .andWhere('id', id)
          .update({ sort_order: i + 1 })
      }
    })
    return { status: 'success', message: 'Orden guardado' }
  }

  public async show({ params, business }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('businessImages')
      .preload('tags')
      .preload('categoryLinks', (l) => l.preload('category').preload('subcategory'))
      .preload('discounts')
      .preload('variations', (v) => {
        v.orderBy('is_default', 'desc').preload('attributes', (a) =>
          a.preload('value', (val) => val.preload('attribute'))
        )
      })
      .firstOrFail()

    return { status: 'success', data: product }
  }

  public async store({ request, business, auth, response }: HttpContext) {
    const data = request.only([
      'name',
      'description',
      'price',
      'cost',
      'sku',
      'tax_rate',
      'low_stock_threshold',
      'business_image_id',
      'stock',
      'status',
    ])
    const categoryLinks = (request.input('category_links') ?? []) as CategoryLinkInput[]
    const tagIds = ((request.input('tag_ids') ?? []) as number[]).map(Number)

    const slug = await SlugService.uniqueFor('products', business.id, data.name)
    const openingStock = Number(data.stock ?? 0)
    const variaciones = (request.input('variations') ?? []) as {
      attributeValueIds: number[]
      sku?: string
      stock?: number
      lowStockThreshold?: number | null
    }[]

    // El SKU se propone solo; el usuario puede haberlo cambiado a mano. Los
    // platos de un restaurante no llevan SKU.
    if (!data.sku?.trim() && business.businessType !== 'restaurant') {
      data.sku = await SkuService.sugerirProducto(business.id, data.name)
    }

    let product: Product
    try {
      product = await db.transaction(async (trx) => {
      const created = await Product.create(
        {
          businessId: business.id,
          name: data.name,
          slug,
          sku: data.sku ?? null,
          description: data.description ?? null,
          price: data.price,
          cost: data.cost ?? null,
          taxRate: business.taxRate,
          lowStockThreshold: data.low_stock_threshold ?? 5,
          businessImageId: data.business_image_id ?? null,
          status: data.status === 'inactivo' ? 'inactivo' : 'activo',
          stock: 0,
        },
        { client: trx }
      )

      await ProductsController.syncCategories(trx, business.id, created.id, categoryLinks)
      await ProductsController.syncTags(trx, business.id, created, tagIds)

      // Con atributos elegidos desde el formulario, el producto nace ya con
      // sus variaciones y sin variación oculta: no hay stock simple que
      // arrastrar ni nada fantasma.
      if (variaciones.length) {
        for (const v of variaciones) {
          await VariationService.crear(
            business,
            created,
            {
              attributeValueIds: v.attributeValueIds,
              sku: v.sku,
              stock: Number(v.stock ?? 0),
              cost: data.cost ?? null,
              lowStockThreshold: v.lowStockThreshold ?? null,
            },
            auth.user!.id,
            trx
          )
        }
        return created
      }

      // Todo producto nace con una variación por defecto: es donde vive el
      // stock mientras no tenga tallas ni colores propios.
      const variation = await ProductVariation.create(
        {
          businessId: business.id,
          productId: created.id,
          sku: data.sku ?? null,
          isDefault: true,
          price: data.price,
          stock: 0,
        },
        { client: trx }
      )

      if (openingStock !== 0) {
        await InventoryService.applyMovement({
          businessId: business.id,
          variationId: variation.id,
          type: 'inicial',
          quantity: openingStock,
          unitCost: data.cost ?? null,
          note: 'Stock inicial al crear el producto',
          userId: auth.user!.id,
          trx,
        })
      }

      return created
      })
    } catch (error) {
      return response.unprocessableEntity({
        status: 'error',
        message:
          error instanceof VariationError
            ? error.message
            : (error as { code?: string }).code === '23505'
              ? 'Ya existe un producto con ese SKU en este negocio'
              : (error as Error).message,
      })
    }

    await product.refresh()
    await product.load('variations', (v) =>
      v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
    )

    return { status: 'success', message: 'Producto creado', data: product }
  }

  /**
   * Alta rápida desde Compras: el producto y todas sus tallas/colores en una
   * sola transacción, con stock 0 (la mercadería entra al recibir la orden).
   *
   * Con variaciones el producto nace sin variación oculta: no hay stock
   * simple que guardar, así que no queda nada fantasma. Sin variaciones nace
   * como cualquier producto simple.
   */
  public async quick({ request, business, auth, response }: HttpContext) {
    const name = String(request.input('name') ?? '').trim()
    const price = Number(request.input('price'))
    const cost = request.input('cost') === undefined ? null : Number(request.input('cost'))
    const variaciones = (request.input('variations') ?? []) as {
      attributeValueIds: number[]
      sku?: string
    }[]
    const sku = request.input('sku') || (await SkuService.sugerirProducto(business.id, name))

    if (name.length < 2) {
      return response.unprocessableEntity({ status: 'error', message: 'Escribe el nombre del producto' })
    }
    if (!Number.isFinite(price) || price < 0) {
      return response.unprocessableEntity({ status: 'error', message: 'El precio base no es válido' })
    }

    try {
      const resultado = await db.transaction(async (trx) => {
        const product = await Product.create(
          {
            businessId: business.id,
            name,
            slug: await SlugService.uniqueFor('products', business.id, name),
            sku,
            price,
            cost,
            taxRate: business.taxRate,
            lowStockThreshold: 5,
            status: 'activo',
            stock: 0,
          },
          { client: trx }
        )

        if (!variaciones.length) {
          const unica = await ProductVariation.create(
            {
              businessId: business.id,
              productId: product.id,
              sku,
              isDefault: true,
              price,
              cost,
              stock: 0,
            },
            { client: trx }
          )
          return { product, variations: [unica] }
        }

        const creadas: ProductVariation[] = []
        for (const v of variaciones) {
          creadas.push(
            await VariationService.crear(
              business,
              product,
              { attributeValueIds: v.attributeValueIds, sku: v.sku, price, cost },
              auth.user!.id,
              trx
            )
          )
        }
        return { product, variations: creadas }
      })

      for (const v of resultado.variations) {
        await v.load('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      }

      return response.created({
        status: 'success',
        message: 'Producto creado',
        data: { ...resultado.product.serialize(), variations: resultado.variations },
      })
    } catch (error) {
      if (error instanceof VariationError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      return response.unprocessableEntity({
        status: 'error',
        message:
          (error as { code?: string }).code === '23505'
            ? 'Ya existe un producto o variación con ese SKU en este negocio'
            : (error as Error).message,
      })
    }
  }

  /** Agrega varias variaciones a un producto de una sola vez (todo o nada). */
  public async addVariations({ params, business, auth, request, response }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    const variaciones = (request.input('variations') ?? []) as {
      attributeValueIds: number[]
      sku?: string
      stock?: number
      lowStockThreshold?: number | null
    }[]

    if (!variaciones.length) {
      return response.unprocessableEntity({ status: 'error', message: 'No hay variaciones que agregar' })
    }

    try {
      const creadas = await db.transaction(async (trx) => {
        const out: ProductVariation[] = []
        for (const v of variaciones) {
          out.push(
            await VariationService.crear(
              business,
              product,
              {
                attributeValueIds: v.attributeValueIds,
                sku: v.sku,
                stock: Number(v.stock ?? 0),
                lowStockThreshold: v.lowStockThreshold ?? null,
              },
              auth.user!.id,
              trx
            )
          )
        }
        return out
      })
      for (const v of creadas) {
        await v.load('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      }
      return response.created({ status: 'success', message: 'Variaciones creadas', data: creadas })
    } catch (error) {
      if (error instanceof VariationError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      return response.unprocessableEntity({
        status: 'error',
        message:
          (error as { code?: string }).code === '23505'
            ? 'Alguna variación repite un SKU de este negocio'
            : (error as Error).message,
      })
    }
  }

  /** SKU que se propone por defecto (producto o variación). Solo sugiere. */
  public async suggestSku({ business, request }: HttpContext) {
    const nombre = String(request.input('name') ?? '')
    const productId = Number(request.input('productId')) || null
    const valueIds = String(request.input('valueIds') ?? '')
      .split(',')
      .map(Number)
      .filter(Boolean)

    if (productId || valueIds.length) {
      const product = productId
        ? await Product.query().where('id', productId).andWhere('business_id', business.id).firstOrFail()
        : null
      const valores = valueIds.length
        ? await db
            .from('product_attribute_values')
            .where('business_id', business.id)
            .whereIn('id', valueIds)
            .select('id', 'value')
        : []
      const ordenados = valueIds
        .map((id) => valores.find((v: any) => v.id === id)?.value)
        .filter(Boolean) as string[]

      return {
        status: 'success',
        data: {
          sku: await SkuService.sugerirVariacion(
            business.id,
            product?.sku ?? (nombre ? await SkuService.sugerirProducto(business.id, nombre) : null),
            ordenados,
            product?.name ?? nombre
          ),
        },
      }
    }

    return { status: 'success', data: { sku: await SkuService.sugerirProducto(business.id, nombre) } }
  }

  public async update({ params, request, business, response }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only([
      'name',
      'description',
      'price',
      'cost',
      'sku',
      'tax_rate',
      'low_stock_threshold',
      'business_image_id',
      'status',
    ])
    const categoryLinks = request.input('category_links') as CategoryLinkInput[] | undefined
    const tagIds = request.input('tag_ids') as number[] | undefined

    // Cambiar el precio base de un producto con tallas/colores: las variaciones
    // que usan el precio base lo siguen solas; si alguna tiene un precio propio
    // hay que decidir (nunca se pisa en silencio).
    const precioAnterior = Number(product.price)
    const cambiaPrecio =
      data.price !== undefined && Math.abs(Number(data.price) - precioAnterior) > 0.004
    const modoPrecio = request.input('price_mode') as 'base_only' | 'all' | undefined
    let variacionesReales: ProductVariation[] = []

    if (cambiaPrecio) {
      variacionesReales = await ProductVariation.query()
        .where('product_id', product.id)
        .where('business_id', business.id)
        .whereRaw(`NOT ${VariationService.SQL_DEFAULT_RETIRADA}`)
        .where('is_default', false)
        .preload('attributes', (a) => a.preload('value'))

      const propias = variacionesReales.filter((v) => Math.abs(Number(v.price) - precioAnterior) > 0.004)

      if (propias.length && modoPrecio !== 'base_only' && modoPrecio !== 'all') {
        return response.status(409).json({
          status: 'error',
          code: 'price_decision',
          message: 'Algunas variaciones tienen un precio distinto al precio base',
          data: {
            precioAnterior,
            precioNuevo: Number(data.price),
            variaciones: propias.map((v) => ({
              id: v.id,
              sku: v.sku,
              label:
                v.attributes
                  .map((a) => a.value?.value)
                  .filter(Boolean)
                  .join(' · ') || v.sku,
              precio: Number(v.price),
            })),
            total: variacionesReales.length,
          },
        })
      }
    }

    // El slug solo se regenera si cambió el nombre, para no romper enlaces
    // que ya estén circulando por WhatsApp.
    if (data.name && data.name !== product.name) {
      product.slug = await SlugService.uniqueFor('products', business.id, data.name, product.id)
    }

    product.merge({
      name: data.name ?? product.name,
      description: data.description ?? product.description,
      price: data.price ?? product.price,
      cost: data.cost ?? product.cost,
      sku: data.sku ?? product.sku,
      // El impuesto lo define el país del negocio; no se edita por producto.
      taxRate: business.taxRate,
      lowStockThreshold: data.low_stock_threshold ?? product.lowStockThreshold,
      businessImageId: data.business_image_id ?? product.businessImageId,
      status: data.status ?? product.status,
    })

    try {
      await db.transaction(async (trx) => {
        product.useTransaction(trx)
        await product.save()

        if (categoryLinks !== undefined) {
          await ProductsController.syncCategories(trx, business.id, product.id, categoryLinks)
        }
        if (tagIds !== undefined) {
          await ProductsController.syncTags(trx, business.id, product, tagIds.map(Number))
        }

        // Un producto sin variaciones propias es una sola variación: su precio
        // y su SKU siguen a los del producto. Si tiene variaciones con marca,
        // color o medida, cada una conserva lo suyo.
        const conAtributos = await trx
          .from('product_variations as v')
          .join('product_variation_attributes as a', 'a.variation_id', 'v.id')
          .where('v.product_id', product.id)
          .count('* as total')
          .first()
        const simple = Number(conAtributos?.total ?? 0) === 0

        if (cambiaPrecio && variacionesReales.length) {
          // 'all' pisa todas; si no, solo las que usaban el precio base.
          const objetivo =
            modoPrecio === 'all'
              ? variacionesReales
              : variacionesReales.filter((v) => Math.abs(Number(v.price) - precioAnterior) <= 0.004)
          if (objetivo.length) {
            await ProductVariation.query({ client: trx })
              .whereIn('id', objetivo.map((v) => v.id))
              .update({ price: Number(data.price) })
          }
        }

        if (simple) {
          const cambios: Record<string, unknown> = {}
          if (data.price !== undefined) cambios.price = data.price
          if (data.sku !== undefined) cambios.sku = data.sku
          if (Object.keys(cambios).length) {
            await ProductVariation.query({ client: trx })
              .where('product_id', product.id)
              .andWhere('is_default', true)
              .update(cambios)
          }
        }
      })
    } catch (error) {
      return response.unprocessableEntity({
        status: 'error',
        message:
          (error as { code?: string }).code === '23505'
            ? 'Ya existe un producto con ese SKU en este negocio'
            : (error as Error).message,
      })
    }

    return { status: 'success', message: 'Producto actualizado', data: product }
  }

  public async destroy({ params, business }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await product.delete()

    return { status: 'success', message: 'Producto eliminado' }
  }
}
