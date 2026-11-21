import BusinessImage from '#models/business_image'
import Order from '#models/order'
import Product from '#models/product'
import { OrderError } from '#services/order_service'
import PosService from '#services/pos_service'
import PromotionService from '#services/promotion_service'
import MenuHoyService from '#services/menu_hoy_service'
import VariationService from '#services/variation_service'
import { InsufficientStockError } from '#services/inventory_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Punto de venta: la caja del mostrador.
 */
export default class PosController {
  /**
   * Catálogo de la caja: todo lo vendible (producto activo y variación con
   * stock, o stock ilimitado), con búsqueda por nombre o código y filtros por
   * categoría, subcategoría y «en promoción». El precio ya trae la promoción
   * vigente, igual que lo cobra la venta.
   */
  public async search({ business, request }: HttpContext) {
    const termino = String(request.input('q', '')).trim()
    const categoryId = Number(request.input('categoryId')) || null
    const subcategoryId = Number(request.input('subcategoryId')) || null
    const soloPromo = ['1', 'true'].includes(String(request.input('promo', '')))
    const promoId = Number(request.input('promoId')) || null
    const pagina = Math.max(1, Number(request.input('page', 1)) || 1)
    const porPagina = Math.min(60, Math.max(6, Number(request.input('perPage', 24)) || 24))

    const disp = await MenuHoyService.disponibilidad(business.id)
    const q = Product.query()
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .whereNotIn('products.id', [...disp.ocultos, ...disp.agotados])
      .preload('businessImages')
      .preload('categoryLinks')
      .preload('variations', (v) => {
        v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      })
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .limit(1000)
    if (termino) {
      q.where((sub) => {
        sub
          .whereILike('name', `%${termino}%`)
          .orWhereILike('sku', `%${termino}%`)
          .orWhereHas('variations', (v) => v.whereILike('sku', `%${termino}%`))
      })
    }
    if (categoryId || subcategoryId) {
      q.whereHas('categoryLinks', (l) => {
        if (categoryId) l.where('category_id', categoryId)
        if (subcategoryId) l.where('subcategory_id', subcategoryId)
      })
    }

    const productos = await q
    const promos = await PromotionService.activas(business.id)
    // Todas las promociones automáticas vigentes (descuento, 2x1, por categoría…);
    // los cupones no, porque necesitan un código.
    const automaticas = promos.filter((d) => !d.code)
    const laPromo = promoId ? automaticas.find((d) => d.id === promoId) : null

    const todos = productos
      .map((p) => {
        const categoryIds = p.categoryLinks.map((l) => l.categoryId)
        const variaciones = VariationService.visibles(p.variations)
          .map((v) => {
            const pv = PromotionService.precioPublico(promos, p.id, categoryIds, Number(v.price), v.id)
            return {
              id: v.id,
              sku: v.sku,
              stock: p.unlimitedStock ? 999 : v.stock,
              price: pv.final,
              originalPrice: pv.descuento > 0 ? pv.original : null,
              isDefault: v.isDefault,
              label: v.attributes
                .map((a) => a.value?.value)
                .filter(Boolean)
                .join(' · '),
            }
          })
          .filter((v) => v.stock > 0)
        const base = PromotionService.precioPublico(promos, p.id, categoryIds, Number(p.price))
        const etiquetas = base.etiquetas.map((e) => e.label)
        const enPromo =
          base.descuento > 0 || etiquetas.length > 0 || variaciones.some((v) => v.originalPrice !== null)
        const precios = variaciones.map((v) => v.price)
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: precios.length ? Math.min(...precios) : base.final,
          originalPrice: base.descuento > 0 ? base.original : null,
          desde: new Set(precios).size > 1,
          promo: enPromo,
          promoLabels: etiquetas,
          unlimitedStock: p.unlimitedStock,
          stock: variaciones.reduce((t, v) => t + v.stock, 0),
          imageUrl: p.businessImages?.url ?? null,
          variations: variaciones,
        }
      })
      .filter((p) => p.variations.length > 0)
      .filter((p) => !soloPromo || p.promo)
      .filter((p) => {
        if (!promoId) return true
        if (!laPromo) return false
        const prod = productos.find((x) => x.id === p.id)!
        const cats = prod.categoryLinks.map((l) => l.categoryId)
        return (
          PromotionService.aplicaA(laPromo, p.id, cats) ||
          p.variations.some((v) => PromotionService.aplicaA(laPromo, p.id, cats, v.id))
        )
      })

    return {
      status: 'success',
      data: todos.slice((pagina - 1) * porPagina, pagina * porPagina),
      meta: {
        total: todos.length,
        page: pagina,
        perPage: porPagina,
        promociones: automaticas.map((d) => ({
          id: d.id,
          name: d.name,
          label: PromotionService.etiqueta(d, business.currencySymbol || 'S/'),
        })),
      },
    }
  }

  public async sell({ business, request, auth, response }: HttpContext) {
    const payments = request.input('payments', [])

    // Los comprobantes tienen que salir de la galería de este negocio, igual
    // que al registrar un pago de un pedido: sin comprobarlo, un id cualquiera
    // colgaría de la venta la captura de otra tienda.
    const comprobantes = payments
      .map((p: any) => p?.receiptImageId)
      .filter((id: unknown) => id !== undefined && id !== null)

    if (comprobantes.length) {
      const encontradas = await BusinessImage.query()
        .where('business_id', business.id)
        .whereIn('id', comprobantes.map(Number))

      if (encontradas.length !== new Set(comprobantes.map(Number)).size) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'El comprobante no pertenece a este negocio',
        })
      }
    }

    try {
      const { order, vuelto } = await PosService.vender(business, {
        items: request.input('items', []),
        payments,
        customerName: request.input('customerName'),
        customerPhone: request.input('customerPhone'),
        discountPercentage: Number(request.input('discountPercentage', 0)),
        couponCode: request.input('couponCode') ?? null,
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
