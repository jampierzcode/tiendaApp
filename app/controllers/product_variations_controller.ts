import ProductVariation from '#models/product_variation'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductVariationsController {
  public async index({ request }: HttpContext) {
    const productId = request.input('productId')

    if (!productId) {
      return { status: 'error', data: [], message: 'No hay productId' }
    }

    const variations = await ProductVariation.query()
      .where('product_id', productId)
      .preload('attributes', (attr) => {
        attr.preload('value', (v) => v.preload('attribute'))
      })

    return { status: 'success', data: variations }
  }

  public async store({ request }: HttpContext) {
    const data = request.only(['product_id', 'sku', 'price', 'stock', 'weight', 'price_modifier'])
    const variation = await ProductVariation.create(data)
    return { status: 'success', message: 'Variation created', data: variation }
  }

  public async update({ params, request }: HttpContext) {
    const variation = await ProductVariation.findOrFail(params.id)

    const data = request.only(['sku', 'price', 'stock', 'weight', 'price_modifier'])

    variation.merge(data)
    await variation.save()

    // Opcional: recargar atributos para devolver todo completo
    await variation.load('attributes', (attr) => {
      attr.preload('value', (v) => v.preload('attribute'))
    })

    return { status: 'success', message: 'Variation updated', data: variation }
  }

  public async destroy({ params }: HttpContext) {
    const variation = await ProductVariation.findOrFail(params.id)
    await variation.delete()
    return { status: 'success', message: 'Variation deleted' }
  }
}
