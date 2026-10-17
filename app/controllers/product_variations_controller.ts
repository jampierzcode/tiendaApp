import BusinessImage from '#models/business_image'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import InventoryService from '#services/inventory_service'
import VariationService, { VariationError } from '#services/variation_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProductVariationsController {
  /**
   * La imagen tiene que salir de la galería de este mismo negocio: sin esta
   * comprobación, mandar un id cualquiera colgaría la foto de otra tienda.
   * Devuelve `undefined` si el campo no viene, para poder distinguir "no lo
   * tocó" de "lo quitó" (null).
   */
  private static async imagenDelNegocio(businessId: number, valor: unknown) {
    if (valor === undefined) return undefined
    if (valor === null || valor === '') return null

    const imagen = await BusinessImage.query()
      .where('id', Number(valor))
      .andWhere('business_id', businessId)
      .first()

    if (!imagen) {
      throw new Error('La imagen elegida no pertenece a este negocio')
    }

    return imagen.id
  }

  public async index({ business, request }: HttpContext) {
    const productId = request.input('productId')

    if (!productId) {
      return { status: 'error', data: [], message: 'Falta productId' }
    }

    const variations = await ProductVariation.query()
      .where('business_id', business.id)
      .andWhere('product_id', productId)
      .preload('attributes', (attr) => {
        attr.preload('value', (v) => v.preload('attribute'))
      })
      .preload('businessImage')
      .orderBy('is_default', 'desc')

    return { status: 'success', data: variations }
  }

  public async store({ request, business, auth, response }: HttpContext) {
    const data = request.only([
      'product_id',
      'sku',
      'price',
      'stock',
      'weight',
      'business_image_id',
      'low_stock_threshold',
    ])

    const product = await Product.query()
      .where('id', data.product_id)
      .andWhere('business_id', business.id)
      .first()

    if (!product) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'El producto indicado no pertenece a este negocio',
      })
    }

    let businessImageId: number | null | undefined
    try {
      businessImageId = await ProductVariationsController.imagenDelNegocio(
        business.id,
        data.business_image_id
      )
    } catch (error) {
      return response.unprocessableEntity({ status: 'error', message: (error as Error).message })
    }

    // Camino atómico: variación + atributos + traslado del stock del producto
    // simple en una sola transacción. Es el que usan Compras y el editor nuevo.
    const attributeValueIds = request.input('attributeValueIds')
    if (Array.isArray(attributeValueIds)) {
      try {
        const creada = await VariationService.crear(
          business,
          product,
          {
            attributeValueIds,
            sku: data.sku,
            price: data.price === undefined || data.price === '' ? null : Number(data.price),
            cost: request.input('cost') ?? null,
            weight: data.weight,
            lowStockThreshold:
              data.low_stock_threshold === undefined || data.low_stock_threshold === ''
                ? null
                : Number(data.low_stock_threshold),
            businessImageId: businessImageId ?? null,
            stock: Number(data.stock ?? 0),
          },
          auth.user!.id
        )
        await creada.load('attributes', (a) => a.preload('value', (v) => v.preload('attribute')))
        await creada.load('businessImage')
        return { status: 'success', message: 'Variación creada', data: creada }
      } catch (error) {
        if (error instanceof VariationError) {
          return response.unprocessableEntity({ status: 'error', message: error.message })
        }
        if ((error as { code?: string }).code === '23505') {
          return response.unprocessableEntity({
            status: 'error',
            message: 'Ya existe una variación con ese SKU en este negocio',
          })
        }
        throw error
      }
    }

    // El stock nunca se escribe directo: entra como movimiento de kardex.
    const variation = await ProductVariation.create({
      businessId: business.id,
      productId: product.id,
      sku: data.sku ?? null,
      isDefault: false,
      price: data.price ?? product.price,
      stock: 0,
      weight: data.weight ?? null,
      businessImageId: businessImageId ?? null,
    })

    const openingStock = Number(data.stock ?? 0)

    if (openingStock !== 0) {
      await InventoryService.applyMovement({
        businessId: business.id,
        variationId: variation.id,
        type: 'inicial',
        quantity: openingStock,
        unitCost: product.cost,
        note: 'Stock inicial al crear la variación',
        userId: auth.user!.id,
      })
      await variation.refresh()
    }

    await variation.load('businessImage')

    return { status: 'success', message: 'Variación creada', data: variation }
  }

  public async update({ params, request, business, response }: HttpContext) {
    const variation = await ProductVariation.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    // El stock no se edita aquí: se cambia con un movimiento de inventario
    // (entrada, salida o ajuste) para que quede el motivo y el autor.
    const data = request.only(['sku', 'price', 'weight', 'business_image_id', 'low_stock_threshold'])

    let businessImageId: number | null | undefined
    try {
      businessImageId = await ProductVariationsController.imagenDelNegocio(
        business.id,
        data.business_image_id
      )
    } catch (error) {
      return response.unprocessableEntity({ status: 'error', message: (error as Error).message })
    }

    variation.merge({
      lowStockThreshold:
        data.low_stock_threshold === undefined
          ? variation.lowStockThreshold
          : data.low_stock_threshold === null || data.low_stock_threshold === ''
            ? null
            : Number(data.low_stock_threshold),
      sku: data.sku ?? variation.sku,
      price: data.price ?? variation.price,
      weight: data.weight ?? variation.weight,
      // `undefined` es "no lo mandó"; `null` es "quitó la foto".
      businessImageId: businessImageId === undefined ? variation.businessImageId : businessImageId,
    })
    await variation.save()

    await variation.load('attributes', (attr) => {
      attr.preload('value', (v) => v.preload('attribute'))
    })
    await variation.load('businessImage')

    return { status: 'success', message: 'Variación actualizada', data: variation }
  }

  public async destroy({ params, business, response }: HttpContext) {
    const variation = await ProductVariation.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    if (variation.isDefault) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'No se puede eliminar la variación por defecto de un producto',
      })
    }

    const productId = variation.productId
    await variation.delete()
    await InventoryService.refreshProductStock(productId)

    return { status: 'success', message: 'Variación eliminada' }
  }
}
