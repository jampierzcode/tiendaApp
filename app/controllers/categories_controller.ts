import Category from '#models/category'
import SlugService from '#services/slug_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class CategoriesController {
  public async index({ business }: HttpContext) {
    const categories = await Category.query()
      .where('business_id', business.id)
      .preload('subcategories')
      .orderBy('name', 'asc')

    return { status: 'success', data: categories }
  }

  public async show({ params, business }: HttpContext) {
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('subcategories')
      .firstOrFail()

    return { status: 'success', data: category }
  }

  public async store({ request, business }: HttpContext) {
    const data = request.only(['name', 'image_url', 'description'])
    const slug = await SlugService.uniqueFor('categories', business.id, data.name)

    const category = await Category.create({
      businessId: business.id,
      name: data.name,
      slug,
      imageUrl: data.image_url ?? null,
      description: data.description ?? null,
    })

    return { status: 'success', message: 'Categoría creada', data: category }
  }

  public async update({ params, request, business }: HttpContext) {
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only(['name', 'image_url', 'description'])

    if (data.name && data.name !== category.name) {
      category.slug = await SlugService.uniqueFor('categories', business.id, data.name, category.id)
    }

    category.merge({
      name: data.name ?? category.name,
      imageUrl: data.image_url ?? category.imageUrl,
      description: data.description ?? category.description,
    })

    await category.save()

    return { status: 'success', message: 'Categoría actualizada', data: category }
  }

  public async destroy({ params, business }: HttpContext) {
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await category.delete()

    return { status: 'success', message: 'Categoría eliminada' }
  }
}
