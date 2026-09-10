import Category from '#models/category'
import Subcategory from '#models/subcategory'
import SlugService from '#services/slug_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class SubcategoriesController {
  public async index({ business, request }: HttpContext) {
    const categoryId = request.input('categoryId')

    const query = Subcategory.query()
      .where('business_id', business.id)
      .preload('category')
      .orderBy('name', 'asc')

    if (categoryId) {
      query.where('category_id', categoryId)
    }

    return { status: 'success', data: await query }
  }

  public async show({ params, business }: HttpContext) {
    const subcategory = await Subcategory.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    return { status: 'success', data: subcategory }
  }

  public async store({ request, business, response }: HttpContext) {
    const data = request.only(['category_id', 'name', 'image_url', 'description'])

    // La categoría padre tiene que ser de este negocio: si no, se podría
    // colgar una subcategoría del árbol de otra tienda.
    const parent = await Category.query()
      .where('id', data.category_id)
      .andWhere('business_id', business.id)
      .first()

    if (!parent) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'La categoría indicada no pertenece a este negocio',
      })
    }

    const slug = await SlugService.uniqueFor('subcategories', business.id, data.name)

    const subcategory = await Subcategory.create({
      businessId: business.id,
      categoryId: parent.id,
      name: data.name,
      slug,
      imageUrl: data.image_url ?? null,
      description: data.description ?? null,
    })

    return { status: 'success', message: 'Subcategoría creada', data: subcategory }
  }

  public async update({ params, request, business }: HttpContext) {
    const subcategory = await Subcategory.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only(['name', 'image_url', 'description'])

    if (data.name && data.name !== subcategory.name) {
      subcategory.slug = await SlugService.uniqueFor(
        'subcategories',
        business.id,
        data.name,
        subcategory.id
      )
    }

    subcategory.merge({
      name: data.name ?? subcategory.name,
      imageUrl: data.image_url ?? subcategory.imageUrl,
      description: data.description ?? subcategory.description,
    })

    await subcategory.save()

    return { status: 'success', message: 'Subcategoría actualizada', data: subcategory }
  }

  public async destroy({ params, business }: HttpContext) {
    const subcategory = await Subcategory.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await subcategory.delete()

    return { status: 'success', message: 'Subcategoría eliminada' }
  }
}
