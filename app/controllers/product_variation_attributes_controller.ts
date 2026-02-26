import ProductVariationAttribute from '#models/product_variation_attribute'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductVariationAttributesController {
  public async index({ params }: HttpContext) {
    const attrs = await ProductVariationAttribute.query()
      .where('variation_id', params.variationId)
      .preload('value', (v) => v.preload('attribute'))

    return { status: 'success', data: attrs }
  }

  public async store({ request }: HttpContext) {
    const variationId = request.input('variationId')

    // ✅ Nuevo: array de IDs para crear/actualizar en bulk
    const attributeValueIds = request.input('attributeValueIds') as number[] | undefined

    if (!variationId) {
      return {
        status: 'error',
        message: 'variationId es requerido',
        data: [],
      }
    }

    if (Array.isArray(attributeValueIds)) {
      // Sync completo de atributos de la variación
      const existing = await ProductVariationAttribute.query().where('variation_id', variationId)

      const existingValueIds = existing.map((a) => a.attributeValueId)

      // IDs a eliminar (están en DB pero no en el array que mandamos)
      const toDeleteIds = existing
        .filter((a) => !attributeValueIds.includes(a.attributeValueId))
        .map((a) => a.id)

      if (toDeleteIds.length) {
        await ProductVariationAttribute.query().whereIn('id', toDeleteIds).delete()
      }

      // IDs a crear (están en el array pero no en DB)
      const toCreate = attributeValueIds.filter((id) => !existingValueIds.includes(id))

      if (toCreate.length) {
        await ProductVariationAttribute.createMany(
          toCreate.map((valId) => ({
            variationId,
            attributeValueId: valId,
          }))
        )
      }

      // Recargar resultado
      const synced = await ProductVariationAttribute.query()
        .where('variation_id', variationId)
        .preload('value', (v) => v.preload('attribute'))

      return {
        status: 'success',
        message: 'Variation attributes synced',
        data: synced,
      }
    }

    // ✅ Compat: modo viejo (un solo attributeValueId)
    const data = request.only(['variationId', 'attributeValueId'])
    const attr = await ProductVariationAttribute.create(data)
    return {
      status: 'success',
      message: 'Variation attribute added',
      data: attr,
    }
  }

  public async destroy({ params }: HttpContext) {
    const attr = await ProductVariationAttribute.findOrFail(params.id)
    await attr.delete()
    return { status: 'success', message: 'Variation attribute deleted' }
  }
}
