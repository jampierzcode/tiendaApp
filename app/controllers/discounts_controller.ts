import Discount from '#models/discount'
import type { HttpContext } from '@adonisjs/core/http'

export default class DiscountsController {
  public async index({ request }: HttpContext) {
    const productId = request.input('product_id')
    const discounts = await Discount.query().where('product_id', productId)
    return { status: 'success', data: discounts }
  }

  public async store({ request }: HttpContext) {
    const data = request.only(['product_id', 'percentage', 'start_date', 'end_date'])
    const discount = await Discount.create(data)
    return { status: 'success', message: 'Discount created', data: discount }
  }

  public async update({ params, request }: HttpContext) {
    const discount = await Discount.findOrFail(params.id)
    discount.merge(request.only(['percentage', 'start_date', 'end_date']))
    await discount.save()
    return { status: 'success', message: 'Discount updated', data: discount }
  }

  public async destroy({ params }: HttpContext) {
    const discount = await Discount.findOrFail(params.id)
    await discount.delete()
    return { status: 'success', message: 'Discount deleted' }
  }
}
