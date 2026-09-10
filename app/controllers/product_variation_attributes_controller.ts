import ProductAttributeValue from '#models/product_attribute_value'
import ProductVariation from '#models/product_variation'
import ProductVariationAttribute from '#models/product_variation_attribute'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductVariationAttributesController {
  public async index({ params, business }: HttpContext) {
    const attrs = await ProductVariationAttribute.query()
      .where('business_id', business.id)
      .andWhere('variation_id', params.variationId)
      .preload('value', (v) => v.preload('attribute'))

    return { status: 'success', data: attrs }
  }

  /**
   * Sincroniza de una vez los atributos de una variación: recibe la lista
   * completa de valores y deja la variación exactamente con esos.
   */
  public async store({ request, business, response }: HttpContext) {
    const variationId = request.input('variationId')
    const attributeValueIds = request.input('attributeValueIds') as number[] | undefined

    if (!variationId) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'variationId es requerido',
      })
    }

    const variation = await ProductVariation.query()
      .where('id', variationId)
      .andWhere('business_id', business.id)
      .first()

    if (!variation) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'La variación indicada no pertenece a este negocio',
      })
    }

    const requested = Array.isArray(attributeValueIds) ? attributeValueIds : []

    // Solo se aceptan valores del propio negocio: de lo contrario se podría
    // etiquetar una variación con los colores de otra tienda.
    const validValues = await ProductAttributeValue.query()
      .where('business_id', business.id)
      .whereIn('id', requested.length ? requested : [0])
      .select('id')

    const validIds = validValues.map((value) => value.id)

    const existing = await ProductVariationAttribute.query()
      .where('business_id', business.id)
      .andWhere('variation_id', variation.id)

    const existingValueIds = existing.map((a) => a.attributeValueId)

    const toDelete = existing.filter((a) => !validIds.includes(a.attributeValueId)).map((a) => a.id)

    if (toDelete.length) {
      await ProductVariationAttribute.query().whereIn('id', toDelete).delete()
    }

    const toCreate = validIds.filter((id) => !existingValueIds.includes(id))

    if (toCreate.length) {
      await ProductVariationAttribute.createMany(
        toCreate.map((valueId) => ({
          businessId: business.id,
          variationId: variation.id,
          attributeValueId: valueId,
        }))
      )
    }

    const synced = await ProductVariationAttribute.query()
      .where('variation_id', variation.id)
      .preload('value', (v) => v.preload('attribute'))

    return { status: 'success', message: 'Atributos sincronizados', data: synced }
  }

  public async destroy({ params, business }: HttpContext) {
    const attr = await ProductVariationAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await attr.delete()

    return { status: 'success', message: 'Atributo de variación eliminado' }
  }
}
