import Product from '#models/product'
import Business from '#models/business'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductsController {
  public async index({ auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const products = await Product.query()
      .where('business_id', business.id)
      .preload('businessImages')
    return { status: 'success', data: products }
  }
  public async getByBusiness({ params }: HttpContext) {
    const businessId = params.businessId

    const products = await Product.query()
      .where('business_id', businessId)
      .preload('businessImages')
      .preload('variations', (v) => {
        v.preload('attributes')
      })
      .orderBy('id', 'desc')

    return { status: 'success', data: products }
  }

  public async show({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    return { status: 'success', data: product }
  }

  public async store({ request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const data = request.only(['name', 'description', 'price', 'business_image_id', 'stock'])
    const product = await Product.create({
      businessId: business.id,
      ...data,
    })
    return { status: 'success', message: 'Product created', data: product }
  }

  public async update({ params, request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    product.merge(
      request.only(['name', 'description', 'price', 'business_image_id', 'status', 'stock'])
    )
    await product.save()

    return { status: 'success', message: 'Product updated', data: product }
  }

  public async destroy({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const product = await Product.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    await product.delete()
    return { status: 'success', message: 'Product deleted' }
  }
}
