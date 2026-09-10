import Order from '#models/order'
import Product from '#models/product'
import { OrderError } from '#services/order_service'
import PosService from '#services/pos_service'
import { InsufficientStockError } from '#services/inventory_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Punto de venta: la caja del mostrador.
 */
export default class PosController {
  /**
   * Búsqueda rápida para la caja: por nombre o por código.
   *
   * Devuelve solo lo vendible — producto activo y variación con stock — para
   * que el vendedor no le prometa al cliente algo que no hay.
   */
  public async search({ business, request }: HttpContext) {
    const termino = String(request.input('q', '')).trim()

    if (termino.length < 2) {
      return { status: 'success', data: [] }
    }

    const productos = await Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .where((sub) => {
        sub.whereILike('name', `%${termino}%`).orWhereILike('sku', `%${termino}%`)
      })
      .preload('businessImages')
      .preload('variations', (v) => {
        v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      })
      .limit(12)

    return {
      status: 'success',
      data: productos.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: Number(p.price),
        imageUrl: p.businessImages?.url ?? null,
        variations: p.variations
          .map((v) => ({
            id: v.id,
            sku: v.sku,
            stock: v.stock,
            price: Number(v.price) + Number(v.priceModifier ?? 0),
            isDefault: v.isDefault,
            label: v.attributes
              .map((a) => a.value?.value)
              .filter(Boolean)
              .join(' · '),
          }))
          .filter((v) => v.stock > 0),
      })).filter((p) => p.variations.length > 0),
    }
  }

  public async sell({ business, request, auth, response }: HttpContext) {
    try {
      const { order, vuelto } = await PosService.vender(business, {
        items: request.input('items', []),
        payments: request.input('payments', []),
        customerName: request.input('customerName'),
        customerPhone: request.input('customerPhone'),
        discountPercentage: Number(request.input('discountPercentage', 0)),
        note: request.input('note'),
        userId: auth.user!.id,
      })

      return response.created({
        status: 'success',
        message: `Venta ${order.code} registrada`,
        data: { order, vuelto },
      })
    } catch (error) {
      if (error instanceof OrderError || error instanceof InsufficientStockError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Datos del ticket para imprimir. */
  public async ticket({ params, business, response }: HttpContext) {
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .preload('items')
      .preload('payments')
      .first()

    if (!order) {
      return response.notFound({ status: 'error', message: 'Venta no encontrada' })
    }

    return {
      status: 'success',
      data: {
        order,
        negocio: {
          name: business.name,
          address: business.address,
          phone: business.phone ?? business.whatsappPhone,
          city: business.city,
          currencySymbol: business.currencySymbol,
        },
      },
    }
  }
}
