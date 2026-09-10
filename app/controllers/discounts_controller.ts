import Discount from '#models/discount'
import Product from '#models/product'
import type { HttpContext } from '@adonisjs/core/http'

export default class DiscountsController {
  public async index({ business, request }: HttpContext) {
    const productId = request.input('productId')

    const query = Discount.query().where('business_id', business.id).preload('product')

    if (productId) {
      query.where('product_id', productId)
    }

    return { status: 'success', data: await query }
  }

  public async store({ request, business, response }: HttpContext) {
    const data = request.only(['product_id', 'percentage', 'start_date', 'end_date'])

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

    const discount = await Discount.create({
      businessId: business.id,
      productId: product.id,
      percentage: data.percentage,
      startDate: data.start_date,
      endDate: data.end_date,
    })

    return { status: 'success', message: 'Descuento creado', data: discount }
  }

  public async update({ params, request, business }: HttpContext) {
    const discount = await Discount.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    discount.merge(request.only(['percentage', 'start_date', 'end_date']))
    await discount.save()

    return { status: 'success', message: 'Descuento actualizado', data: discount }
  }

  public async destroy({ params, business }: HttpContext) {
    const discount = await Discount.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await discount.delete()

    return { status: 'success', message: 'Descuento eliminado' }
  }
}
