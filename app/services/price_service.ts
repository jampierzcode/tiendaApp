import type Business from '#models/business'
import PriceReview from '#models/price_review'
import Product from '#models/product'
import PricingService from '#services/pricing_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export class PriceError extends Error {}

/**
 * Cambios del precio de venta. Hay un solo precio por producto, el mismo para
 * todas sus variaciones. Nunca cambia solo y exige confirmación explícita:
 * sin ella solo devuelve la vista previa.
 *
 * Las ventas pasadas no se tocan: `order_items` guarda el precio y el costo de
 * cada línea al momento de vender.
 */
export default class PriceService {
  static async vistaPrevia(business: Business, productId: number, precioNuevo: number) {
    const product = await Product.query()
      .where('id', productId)
      .andWhere('business_id', business.id)
      .preload('variations')
      .firstOrFail()

    if (!Number.isFinite(precioNuevo) || precioNuevo < 0) {
      throw new PriceError('El precio no es válido')
    }

    const costo = product.cost === null || product.cost === undefined ? null : Number(product.cost)

    return {
      productId: product.id,
      producto: product.name,
      precioActual: Number(product.price),
      precioNuevo: PricingService.redondear(precioNuevo),
      costo,
      margenNuevo:
        costo !== null && precioNuevo > 0
          ? Math.round(((precioNuevo - costo) / precioNuevo) * 1000) / 10
          : null,
      variacionesAfectadas: product.variations.filter((v) => !v.isDefault || product.variations.length === 1)
        .length,
    }
  }

  /** Precio sugerido para un costo dado, sin cambiar nada. */
  static async sugerencia(business: Business, productId: number, costo: number) {
    const product = await Product.query()
      .where('id', productId)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const precio = Number(product.price)
    const anterior = product.cost === null || product.cost === undefined ? null : Number(product.cost)
    const { precio: sugerido, margen } = PricingService.sugerirPrecio(costo, precio, anterior)

    return { productId: product.id, precioActual: precio, costoActual: anterior, costo, precioSugerido: sugerido, margenPct: margen }
  }

  static async aplicar(
    business: Business,
    productId: number,
    precioNuevo: number,
    opciones: { confirm: boolean; userId: number }
  ) {
    const vista = await this.vistaPrevia(business, productId, precioNuevo)
    if (!opciones.confirm) return { aplicado: false as const, vista }

    await db.transaction(async (trx) => {
      await trx.from('products').where('id', productId).update({ price: vista.precioNuevo })
      await trx
        .from('product_variations')
        .where('product_id', productId)
        .update({ price: vista.precioNuevo })

      await trx
        .from('price_reviews')
        .where('business_id', business.id)
        .andWhere('product_id', productId)
        .andWhere('status', 'pendiente')
        .update({
          status: 'aplicada',
          applied_price: vista.precioNuevo,
          resolved_at: DateTime.now().toSQL(),
          resolved_by: opciones.userId,
        })
    })

    return { aplicado: true as const, vista }
  }

  static async pendientes(business: Business) {
    return PriceReview.query()
      .where('business_id', business.id)
      .andWhere('status', 'pendiente')
      .preload('product', (p) => p.select('id', 'name', 'price', 'cost'))
      .orderBy('id', 'desc')
  }

  static async descartar(business: Business, reviewId: number, userId: number) {
    const revision = await PriceReview.query()
      .where('id', reviewId)
      .andWhere('business_id', business.id)
      .firstOrFail()

    if (revision.status !== 'pendiente') throw new PriceError('Esta revisión ya fue resuelta')

    revision.status = 'descartada'
    revision.resolvedAt = DateTime.now()
    revision.resolvedBy = userId
    await revision.save()
    return revision
  }
}
