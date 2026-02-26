import ProductAttribute from '#models/product_attribute'
import Business from '#models/business'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductAttributesController {
  public async index({ auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const attributes = await ProductAttribute.query()
      .where('business_id', business.id)
      .preload('values')
    return { status: 'success', data: attributes }
  }

  public async show({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const attribute = await ProductAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('values')
      .firstOrFail()
    return { status: 'success', data: attribute }
  }

  public async store({ request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const data = request.only(['name', 'type', 'is_required', 'is_filterable'])
    const attribute = await ProductAttribute.create({
      businessId: business.id,
      ...data,
    })
    return { status: 'success', message: 'Attribute created', data: attribute }
  }

  public async update({ params, request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const attribute = await ProductAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    attribute.merge(request.only(['name', 'type', 'is_required', 'is_filterable']))
    await attribute.save()
    return { status: 'success', message: 'Attribute updated', data: attribute }
  }

  public async destroy({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const attribute = await ProductAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    await attribute.delete()
    return { status: 'success', message: 'Attribute deleted' }
  }
}
