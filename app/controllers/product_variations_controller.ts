import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import InventoryService from '#services/inventory_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductVariationsController {
  public async index({ business, request }: HttpContext) {
    const productId = request.input('productId')

    if (!productId) {
      return { status: 'error', data: [], message: 'Falta productId' }
    }

    const variations = await ProductVariation.query()
      .where('business_id', business.id)
      .andWhere('product_id', productId)
      .preload('attributes', (attr) => {
        attr.preload('value', (v) => v.preload('attribute'))
      })
      .orderBy('is_default', 'desc')

    return { status: 'success', data: variations }
  }

  public async store({ request, business, auth, response }: HttpContext) {
    const data = request.only(['product_id', 'sku', 'price', 'stock', 'weight', 'price_modifier'])

    const product = await Product.query()
      .where('id', data.product_id)
      .andWhere('business_id', business.id)
      .first()

    if (!product) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'El producto indicado no pertenece a este negocio',
      })
    }

    // El stock nunca se escribe directo: entra como movimiento de kardex.
    const variation = await ProductVariation.create({
      businessId: business.id,
      productId: product.id,
      sku: data.sku ?? null,
      isDefault: false,
      price: data.price,
      stock: 0,
      weight: data.weight ?? null,
      priceModifier: data.price_modifier ?? 0,
    })

    const openingStock = Number(data.stock ?? 0)

    if (openingStock !== 0) {
      await InventoryService.applyMovement({
        businessId: business.id,
        variationId: variation.id,
        type: 'inicial',
        quantity: openingStock,
        unitCost: product.cost,
        note: 'Stock inicial al crear la variación',
        userId: auth.user!.id,
      })
      await variation.refresh()
    }

    return { status: 'success', message: 'Variación creada', data: variation }
  }

  public async update({ params, request, business, auth }: HttpContext) {
    const variation = await ProductVariation.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only(['sku', 'price', 'stock', 'weight', 'price_modifier'])

    variation.merge({
      sku: data.sku ?? variation.sku,
      price: data.price ?? variation.price,
      weight: data.weight ?? variation.weight,
      priceModifier: data.price_modifier ?? variation.priceModifier,
    })
    await variation.save()

    // Cambiar el stock desde el panel es un ajuste de inventario y como tal
    // queda registrado, con su motivo y su autor.
    if (data.stock !== undefined && Number(data.stock) !== variation.stock) {
      await InventoryService.setStock({
        businessId: business.id,
        variationId: variation.id,
        newStock: Number(data.stock),
        userId: auth.user!.id,
      })
      await variation.refresh()
    }

    await variation.load('attributes', (attr) => {
      attr.preload('value', (v) => v.preload('attribute'))
    })

    return { status: 'success', message: 'Variación actualizada', data: variation }
  }

  public async destroy({ params, business, response }: HttpContext) {
    const variation = await ProductVariation.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    if (variation.isDefault) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'No se puede eliminar la variación por defecto de un producto',
      })
    }

    const productId = variation.productId
    await variation.delete()
    await InventoryService.refreshProductStock(productId)

    return { status: 'success', message: 'Variación eliminada' }
  }
}
