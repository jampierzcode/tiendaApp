import ProductAttribute from '#models/product_attribute'
import ProductAttributeValue from '#models/product_attribute_value'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductAttributeValuesController {
  public async index({ business, request }: HttpContext) {
    const attributeId = request.input('attributeId')

    const query = ProductAttributeValue.query()
      .where('business_id', business.id)
      .preload('attribute')

    if (attributeId) {
      query.where('attribute_id', attributeId)
    }

    return { status: 'success', data: await query }
  }

  public async store({ request, business, response }: HttpContext) {
    const data = request.only(['attribute_id', 'value', 'hex_color'])

    const attribute = await ProductAttribute.query()
      .where('id', data.attribute_id)
      .andWhere('business_id', business.id)
      .first()

    if (!attribute) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'El atributo indicado no pertenece a este negocio',
      })
    }

    const value = await ProductAttributeValue.create({
      businessId: business.id,
      attributeId: attribute.id,
      value: data.value,
      hexColor: data.hex_color ?? null,
    })

    return { status: 'success', message: 'Valor creado', data: value }
  }

  public async update({ params, request, business }: HttpContext) {
    const value = await ProductAttributeValue.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    value.merge(request.only(['value', 'hex_color']))
    await value.save()

    return { status: 'success', message: 'Valor actualizado', data: value }
  }

  public async destroy({ params, business }: HttpContext) {
    const value = await ProductAttributeValue.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await value.delete()

    return { status: 'success', message: 'Valor eliminado' }
  }
}
