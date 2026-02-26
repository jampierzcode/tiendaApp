import CategoryProduct from '#models/category_product'
import Business from '#models/business'
import type { HttpContext } from '@adonisjs/core/http'

export default class CategoryProductsController {
  public async index({ auth }: HttpContext) {
    const user = auth.user!
    await Business.findByOrFail('user_id', user.id)
    const categoryProducts = await CategoryProduct.query()
      .preload('product')
      .preload('category')
      .preload('subcategory')
    return { status: 'success', data: categoryProducts }
  }

  public async store({ request }: HttpContext) {
    const data = request.only(['productId', 'categoryId', 'subcategoryId'])
    const record = await CategoryProduct.create(data)
    return { status: 'success', message: 'CategoryProduct created', data: record }
  }

  public async destroy({ params }: HttpContext) {
    const record = await CategoryProduct.findOrFail(params.id)
    await record.delete()
    return { status: 'success', message: 'CategoryProduct deleted' }
  }
}
