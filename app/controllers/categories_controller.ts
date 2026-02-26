import Category from '#models/category'
import Business from '#models/business'
import type { HttpContext } from '@adonisjs/core/http'

import slugifyLib from 'slugify'
const slugify = slugifyLib.default || slugifyLib

export default class CategoriesController {
  public async index({ auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const categories = await Category.query()
      .where('business_id', business.id)
      .preload('subcategories')
    return { status: 'success', data: categories }
  }

  public async getByBusiness({ params }: HttpContext) {
    const categories = await Category.query()
      .where('business_id', params.businessId)
      .preload('subcategories')
      .orderBy('id', 'desc')
    return { status: 'success', data: categories }
  }

  public async show({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('subcategories')
      .firstOrFail()
    return { status: 'success', data: category }
  }

  public async store({ request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const data = request.only(['name', 'image_url', 'description'])
    const slug = slugify(data.name)

    const category = await Category.create({
      businessId: business.id,
      ...data,
      slug,
    })
    return { status: 'success', message: 'Category created', data: category }
  }

  public async update({ params, request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    category.merge(request.only(['name', 'image_url', 'description']))
    await category.save()

    return { status: 'success', message: 'Category updated', data: category }
  }

  public async destroy({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await category.delete()
    return { status: 'success', message: 'Category deleted' }
  }
}
