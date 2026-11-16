import BusinessImage from '#models/business_image'
import Product from '#models/product'
import ProductImage from '#models/product_image'
import ProductVariation from '#models/product_variation'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

const MAX_FOTOS = 10

/**
 * Galería de fotos de un producto y de cada variación. La foto principal
 * sigue siendo `business_image_id`; aquí van las demás, en orden.
 */
export default class ProductGalleryController {
  public async show({ business, params }: HttpContext) {
    const product = await Product.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()
    const filas = await ProductImage.query()
      .where('product_id', product.id)
      .preload('image')
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')

    const variations: Record<number, { id: number; url: string }[]> = {}
    const propias: { id: number; url: string }[] = []
    for (const f of filas) {
      if (!f.image) continue
      const foto = { id: f.image.id, url: f.image.url }
      if (f.productVariationId) (variations[f.productVariationId] ??= []).push(foto)
      else propias.push(foto)
    }
    return { status: 'success', data: { product: propias, variations } }
  }

  /** Reemplaza la galería del producto (variationId null) o de una variación. */
  public async update({ business, params, request, response }: HttpContext) {
    const product = await Product.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    const variationId = request.input('variationId') ? Number(request.input('variationId')) : null
    if (variationId) {
      const v = await ProductVariation.query()
        .where('id', variationId)
        .andWhere('product_id', product.id)
        .first()
      if (!v) return response.unprocessableEntity({ status: 'error', message: 'Variación no válida' })
    }

    const ids = [
      ...new Set(((request.input('imageIds') ?? []) as unknown[]).map(Number).filter((n) => n > 0)),
    ]
    if (ids.length > MAX_FOTOS) {
      return response.unprocessableEntity({
        status: 'error',
        message: `Máximo ${MAX_FOTOS} fotos por galería`,
      })
    }
    const validas = ids.length
      ? await BusinessImage.query().where('business_id', business.id).whereIn('id', ids)
      : []
    if (validas.length !== ids.length) {
      return response.unprocessableEntity({ status: 'error', message: 'Alguna foto no es de tu galería' })
    }

    await db.transaction(async (trx) => {
      const borrar = ProductImage.query({ client: trx }).where('product_id', product.id)
      if (variationId) borrar.where('product_variation_id', variationId)
      else borrar.whereNull('product_variation_id')
      await borrar.delete()
      for (const [i, imageId] of ids.entries()) {
        await ProductImage.create(
          {
            businessId: business.id,
            productId: product.id,
            productVariationId: variationId,
            businessImageId: imageId,
            sortOrder: i,
          },
          { client: trx }
        )
      }
    })

    return { status: 'success', message: 'Galería actualizada' }
  }
}
