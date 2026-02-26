import Subcategory from '#models/subcategory'

import type { HttpContext } from '@adonisjs/core/http'
import slugifyLib from 'slugify'
const slugify = slugifyLib.default || slugifyLib

export default class SubcategoriesController {
  public async index({ params }: HttpContext) {
    const subcategories = await Subcategory.query().where('category_id', params.categoryId)
    return { status: 'success', data: subcategories }
  }
  public async getByBusiness({ params }: HttpContext) {
    const categories = await Subcategory.query()
      .where('business_id', params.businessId)
      .preload('category')
      .orderBy('id', 'desc')
    return { status: 'success', data: categories }
  }

  public async show({ params }: HttpContext) {
    const subcategory = await Subcategory.findOrFail(params.id)
    return { status: 'success', data: subcategory }
  }

  public async store({ request }: HttpContext) {
    const data = request.only(['category_id', 'name', 'image_url', 'description'])
    const slug = slugify(data.name)
    const subcategory = await Subcategory.create({ ...data, slug })
    return { status: 'success', message: 'Subcategory created', data: subcategory }
  }

  public async update({ params, request }: HttpContext) {
    const subcategory = await Subcategory.findOrFail(params.id)
    subcategory.merge(request.only(['name', 'image_url', 'description']))
    await subcategory.save()
    return { status: 'success', message: 'Subcategory updated', data: subcategory }
  }

  public async destroy({ params }: HttpContext) {
    const subcategory = await Subcategory.findOrFail(params.id)
    await subcategory.delete()
    return { status: 'success', message: 'Subcategory deleted' }
  }
}
