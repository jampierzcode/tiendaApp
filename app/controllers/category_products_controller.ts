import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Product from '#models/product'
import Subcategory from '#models/subcategory'
import type { HttpContext } from '@adonisjs/core/http'

export default class CategoryProductsController {
  public async index({ business, request }: HttpContext) {
    const productId = request.input('productId')

    const query = CategoryProduct.query()
      .where('business_id', business.id)
      .preload('product')
      .preload('category')
      .preload('subcategory')

    if (productId) {
      query.where('product_id', productId)
    }

    return { status: 'success', data: await query }
  }

  public async store({ request, business, response }: HttpContext) {
    const productId = request.input('productId')
    const categoryId = request.input('categoryId')
    const subcategoryId = request.input('subcategoryId') ?? null

    // Las tres piezas tienen que ser del mismo negocio.
    const [product, category] = await Promise.all([
      Product.query().where('id', productId).andWhere('business_id', business.id).first(),
      Category.query().where('id', categoryId).andWhere('business_id', business.id).first(),
    ])

    if (!product || !category) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'El producto o la categoría no pertenecen a este negocio',
      })
    }

    if (subcategoryId) {
      const subcategory = await Subcategory.query()
        .where('id', subcategoryId)
        .andWhere('business_id', business.id)
        .andWhere('category_id', category.id)
        .first()

      if (!subcategory) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'La subcategoría no pertenece a esta categoría',
        })
      }
    }

    const record = await CategoryProduct.firstOrCreate(
      {
        businessId: business.id,
        productId: product.id,
        categoryId: category.id,
        subcategoryId,
      },
      {
        businessId: business.id,
        productId: product.id,
        categoryId: category.id,
        subcategoryId,
      }
    )

    return { status: 'success', message: 'Producto asignado a la categoría', data: record }
  }

  public async destroy({ params, business }: HttpContext) {
    const record = await CategoryProduct.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await record.delete()

    return { status: 'success', message: 'Asignación eliminada' }
  }
}
