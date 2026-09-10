import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import InventoryService from '#services/inventory_service'
import SlugService from '#services/slug_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

/**
 * Productos del negocio abierto en el panel.
 *
 * El negocio llega en `ctx.business`, puesto por TenantMiddleware desde el
 * `:businessUuid` de la ruta. Ningún método vuelve a deducirlo del usuario.
 */
export default class ProductsController {
  public async index({ business, request }: HttpContext) {
    const search = request.input('search')
    const status = request.input('status')
    const categoryId = request.input('categoryId')

    const query = Product.query()
      .where('business_id', business.id)
      .preload('businessImages')
      .preload('tags')
      .preload('variations', (v) => {
        v.orderBy('is_default', 'desc').preload('attributes', (a) =>
          a.preload('value', (val) => val.preload('attribute'))
        )
      })
      .orderBy('id', 'desc')

    if (search) {
      query.where((sub) => {
        sub.whereILike('name', `%${search}%`).orWhereILike('sku', `%${search}%`)
      })
    }

    if (status) {
      query.where('status', status)
    }

    if (categoryId) {
      query.whereHas('categoryLinks', (link) => link.where('category_id', categoryId))
    }

    const products = await query

    return { status: 'success', data: products }
  }

  public async show({ params, business }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('businessImages')
      .preload('tags')
      .preload('discounts')
      .preload('variations', (v) => {
        v.orderBy('is_default', 'desc').preload('attributes', (a) =>
          a.preload('value', (val) => val.preload('attribute'))
        )
      })
      .firstOrFail()

    return { status: 'success', data: product }
  }

  public async store({ request, business, auth }: HttpContext) {
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
    ])

    const slug = await SlugService.uniqueFor('products', business.id, data.name)
    const openingStock = Number(data.stock ?? 0)

    const product = await db.transaction(async (trx) => {
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
          stock: 0,
        },
        { client: trx }
      )

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

    await product.refresh()
    await product.load('variations')

    return { status: 'success', message: 'Producto creado', data: product }
  }

  public async update({ params, request, business }: HttpContext) {
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

    await product.save()

    // El precio de la variación por defecto sigue al del producto.
    if (data.price !== undefined) {
      await ProductVariation.query()
        .where('product_id', product.id)
        .andWhere('is_default', true)
        .update({ price: data.price })
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
