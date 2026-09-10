import Product from '#models/product'
import Tag from '#models/tag'
import SlugService from '#services/slug_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class TagsController {
  public async index({ business }: HttpContext) {
    const tags = await Tag.query().where('business_id', business.id).orderBy('name', 'asc')
    return { status: 'success', data: tags }
  }

  public async store({ request, business }: HttpContext) {
    const data = request.only(['name', 'color'])
    const slug = await SlugService.uniqueFor('tags', business.id, data.name)

    const tag = await Tag.create({
      businessId: business.id,
      name: data.name,
      slug,
      color: data.color ?? null,
    })

    return { status: 'success', message: 'Etiqueta creada', data: tag }
  }

  public async update({ params, request, business }: HttpContext) {
    const tag = await Tag.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only(['name', 'color'])

    if (data.name && data.name !== tag.name) {
      tag.slug = await SlugService.uniqueFor('tags', business.id, data.name, tag.id)
    }

    tag.merge({ name: data.name ?? tag.name, color: data.color ?? tag.color })
    await tag.save()

    return { status: 'success', message: 'Etiqueta actualizada', data: tag }
  }

  public async destroy({ params, business }: HttpContext) {
    const tag = await Tag.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await tag.delete()

    return { status: 'success', message: 'Etiqueta eliminada' }
  }

  /** Reemplaza las etiquetas de un producto por la lista recibida. */
  public async syncForProduct({ params, request, business, response }: HttpContext) {
    const product = await Product.query()
      .where('id', params.productId)
      .andWhere('business_id', business.id)
      .first()

    if (!product) {
      return response.notFound({ status: 'error', message: 'Producto no encontrado' })
    }

    const requested = (request.input('tagIds') ?? []) as number[]

    const validTags = await Tag.query()
      .where('business_id', business.id)
      .whereIn('id', requested.length ? requested : [0])
      .select('id')

    await product.related('tags').sync(
      Object.fromEntries(validTags.map((tag) => [tag.id, { business_id: business.id }]))
    )

    await product.load('tags')

    return { status: 'success', message: 'Etiquetas actualizadas', data: product.tags }
  }
}
