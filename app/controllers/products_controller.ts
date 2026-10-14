import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import InventoryService from '#services/inventory_service'
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
          taxRate: data.tax_rate ?? 18,
          lowStockThreshold: data.low_stock_threshold ?? 5,
          businessImageId: data.business_image_id ?? null,
          status: data.status === 'inactivo' ? 'inactivo' : 'activo',
          stock: 0,
        },
        { client: trx }
      )

      await ProductsController.syncCategories(trx, business.id, created.id, categoryLinks)
      await ProductsController.syncTags(trx, business.id, created, tagIds)

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
          (error as { code?: string }).code === '23505'
            ? 'Ya existe un producto con ese SKU en este negocio'
            : (error as Error).message,
      })
    }

    await product.refresh()
    await product.load('variations')

    return { status: 'success', message: 'Producto creado', data: product }
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
      taxRate: data.tax_rate ?? product.taxRate,
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
