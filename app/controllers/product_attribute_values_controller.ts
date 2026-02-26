import ProductAttributeValue from '#models/product_attribute_value'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductAttributeValuesController {
  public async index() {
    const values = await ProductAttributeValue.query().preload('attribute')
    return { status: 'success', data: values }
  }

  public async store({ request }: HttpContext) {
    const data = request.only(['attribute_id', 'value', 'hex_color'])
    const value = await ProductAttributeValue.create(data)
    return { status: 'success', message: 'Attribute value created', data: value }
  }

  public async destroy({ params }: HttpContext) {
    const value = await ProductAttributeValue.findOrFail(params.id)
    await value.delete()
    return { status: 'success', message: 'Attribute value deleted' }
  }
}
