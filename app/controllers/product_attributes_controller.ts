import ProductAttribute from '#models/product_attribute'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductAttributesController {
  public async index({ business }: HttpContext) {
    const attributes = await ProductAttribute.query()
      .where('business_id', business.id)
      .preload('values')
      .orderBy('id', 'asc')

    return { status: 'success', data: attributes }
  }

  public async show({ params, business }: HttpContext) {
    const attribute = await ProductAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('values')
      .firstOrFail()

    return { status: 'success', data: attribute }
  }

  public async store({ request, business }: HttpContext) {
    const data = request.only(['name', 'type', 'is_required', 'is_filterable'])

    const attribute = await ProductAttribute.create({
      businessId: business.id,
      name: data.name,
      type: data.type ?? 'text',
      isRequired: data.is_required ?? false,
      isFilterable: data.is_filterable ?? true,
    })

    return { status: 'success', message: 'Atributo creado', data: attribute }
  }

  public async update({ params, request, business }: HttpContext) {
    const attribute = await ProductAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    attribute.merge(request.only(['name', 'type', 'is_required', 'is_filterable']))
    await attribute.save()

    return { status: 'success', message: 'Atributo actualizado', data: attribute }
  }

  public async destroy({ params, business }: HttpContext) {
    const attribute = await ProductAttribute.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await attribute.delete()

    return { status: 'success', message: 'Atributo eliminado' }
  }
}
