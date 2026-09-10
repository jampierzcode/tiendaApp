import PurchaseOrder from '#models/purchase_order'
import ReturnNote from '#models/return_note'
import PurchaseService, { PurchaseError } from '#services/purchase_service'
import { InsufficientStockError } from '#services/inventory_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class PurchasesController {
  public async index({ business, request }: HttpContext) {
    const status = request.input('status')

    const query = PurchaseOrder.query()
      .where('business_id', business.id)
      .preload('supplier')
      .preload('items')
      .orderBy('id', 'desc')

    if (status) query.where('status', status)

    return { status: 'success', data: await query }
  }

  public async show({ params, business }: HttpContext) {
    const orden = await PurchaseOrder.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .preload('supplier')
      .preload('items', (i) => i.preload('variation', (v) => v.preload('product')))
      .firstOrFail()

    return { status: 'success', data: orden }
  }

  public async store({ request, business, auth, response }: HttpContext) {
    try {
      const orden = await PurchaseService.crearOrden(
        business,
        {
          supplierId: Number(request.input('supplierId')),
          documentNumber: request.input('documentNumber') ?? null,
          note: request.input('note') ?? null,
          items: request.input('items', []),
        },
        auth.user!.id
      )

      return response.created({
        status: 'success',
        message: `Orden ${orden.code} creada`,
        data: orden,
      })
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Recibe la mercadería: es lo que la mete al inventario. */
  public async receive({ params, business, auth, response }: HttpContext) {
    try {
      const orden = await PurchaseService.recibir(business, Number(params.id), auth.user!.id)
      return {
        status: 'success',
        message: `Mercadería de ${orden.code} ingresada al inventario`,
        data: orden,
      }
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async cancel({ params, business, response }: HttpContext) {
    try {
      const orden = await PurchaseService.cancelarOrden(business, Number(params.id))
      return { status: 'success', message: 'Orden cancelada', data: orden }
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  // --- Devoluciones ---

  public async returnsIndex({ business }: HttpContext) {
    const devoluciones = await ReturnNote.query()
      .where('business_id', business.id)
      .preload('order')
      .preload('items', (i) => i.preload('orderItem'))
      .preload('user', (u) => u.select('id', 'name'))
      .orderBy('id', 'desc')

    return { status: 'success', data: devoluciones }
  }

  public async createReturn({ request, business, auth, response }: HttpContext) {
    try {
      const devolucion = await PurchaseService.devolver(
        business,
        {
          orderId: Number(request.input('orderId')),
          items: request.input('items', []),
          reason: request.input('reason') ?? null,
          restocked: request.input('restocked') !== false,
        },
        auth.user!.id
      )

      return response.created({
        status: 'success',
        message: `Devolución ${devolucion.code} registrada`,
        data: devolucion,
      })
    } catch (error) {
      if (error instanceof PurchaseError || error instanceof InsufficientStockError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }
}
