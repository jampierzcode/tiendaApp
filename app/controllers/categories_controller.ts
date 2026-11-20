import Category from '#models/category'
import SlugService from '#services/slug_service'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

export default class CategoriesController {
  /** Área de impresión por defecto de los platos de la categoría (PDV de salón). */
  static async aplicarArea(businessId: number, category: Category, valor: unknown) {
    if (valor === undefined) return
    const id = Number(valor) || null
    if (id) {
      const existe = await db.from('production_areas').where('business_id', businessId).andWhere('id', id).first()
      if (!existe) return
    }
    category.productionAreaId = id
    await category.save()
  }

  public async index({ business }: HttpContext) {
    const categories = await Category.query()
      .where('business_id', business.id)
      .preload('subcategories', (s) => s.orderBy('sort_order', 'asc').orderBy('name', 'asc'))
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')

    return { status: 'success', data: categories }
  }


  /** Guarda el orden manual: el primer id queda primero. */
  public async reorder({ business, request, response }: HttpContext) {
    const ids: number[] = (request.input('ids') ?? []).map(Number).filter(Boolean)
    if (!ids.length) {
      return response.unprocessableEntity({ status: 'error', message: 'No hay nada que ordenar' })
    }
    await db.transaction(async (trx) => {
      for (const [i, id] of ids.entries()) {
        await trx
          .from('categories')
          .where('business_id', business.id)
          .andWhere('id', id)
          .update({ sort_order: i + 1 })
      }
    })
    return { status: 'success', message: 'Orden guardado' }
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
    await CategoriesController.aplicarArea(business.id, category, request.input('production_area_id'))

    return { status: 'success', message: 'Categoría creada', data: category }
  }

  public async update({ params, request, business }: HttpContext) {
    const category = await Category.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only(['name', 'image_url', 'description'])
    const activa = request.input('is_active')

    if (data.name && data.name !== category.name) {
      category.slug = await SlugService.uniqueFor('categories', business.id, data.name, category.id)
    }

    category.merge({
      name: data.name ?? category.name,
      imageUrl: data.image_url ?? category.imageUrl,
      description: data.description ?? category.description,
      isActive: activa === undefined ? category.isActive : Boolean(activa),
    })

    await category.save()
    await CategoriesController.aplicarArea(business.id, category, request.input('production_area_id'))

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
