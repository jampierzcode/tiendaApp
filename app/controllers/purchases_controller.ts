import PurchaseOrder from '#models/purchase_order'
import PurchaseReceipt from '#models/purchase_receipt'
import Shipment from '#models/shipment'
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
      .preload('items', (i) =>
        i.preload('variation', (v) =>
          v.preload('product').preload('attributes', (a) => a.preload('value'))
        )
      )
      .firstOrFail()

    const recepciones = await PurchaseReceipt.query()
      .where('purchase_order_id', orden.id)
      .preload('items')
      .orderBy('id', 'desc')
    const envios = await Shipment.query()
      .where('purchase_order_id', orden.id)
      .preload('events', (e) => e.orderBy('happened_at', 'asc'))
      .orderBy('id', 'desc')

    return { status: 'success', data: { ...orden.serialize(), receipts: recepciones, shipments: envios } }
  }

  /** Costos que cobró cada proveedor por una variación o producto. */
  public async costHistory({ business, request, response }: HttpContext) {
    try {
      const data = await PurchaseService.historialCostos(business, {
        variationId: Number(request.input('variationId')) || undefined,
        productId: Number(request.input('productId')) || undefined,
      })
      return { status: 'success', data }
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async store({ request, business, auth, response }: HttpContext) {
    try {
      const orden = await PurchaseService.crearOrden(
        business,
        {
          supplierId: Number(request.input('supplierId')),
          documentNumber: request.input('documentNumber') ?? null,
          note: request.input('note') ?? null,
          expectedAt: request.input('expectedAt') ?? null,
          tipo: request.input('tipo') === 'cotizacion' ? 'cotizacion' : 'orden',
          items: request.input('items', []),
        },
        auth.user!.id
      )

      return response.created({
        status: 'success',
        message:
          orden.status === 'cotizacion' ? `Cotización ${orden.code} guardada` : `Orden ${orden.code} creada`,
        data: orden,
      })
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async update({ params, business, request, response }: HttpContext) {
    try {
      const orden = await PurchaseService.actualizar(business, Number(params.id), {
        supplierId: request.input('supplierId') ? Number(request.input('supplierId')) : undefined,
        documentNumber: request.input('documentNumber'),
        note: request.input('note'),
        expectedAt: request.input('expectedAt'),
        items: request.input('items'),
      })
      return { status: 'success', message: 'Orden actualizada', data: orden }
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Cotización → pedido. Puede pasar a otro proveedor. */
  public async confirm({ params, business, request, response }: HttpContext) {
    try {
      const orden = await PurchaseService.confirmarCotizacion(
        business,
        Number(params.id),
        request.input('supplierId') ? Number(request.input('supplierId')) : undefined
      )
      return { status: 'success', message: `Pedido ${orden.code} creado`, data: orden }
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Recepción física, total o parcial: es lo que mete stock. */
  public async receipt({ params, business, auth, request, response }: HttpContext) {
    try {
      const { orden, receipt, revisiones } = await PurchaseService.recibirParcial(
        business,
        Number(params.id),
        {
          items: request.input('items', []),
          note: request.input('note') ?? null,
          documentNumber: request.input('documentNumber') ?? null,
          shipmentId: request.input('shipmentId') ? Number(request.input('shipmentId')) : null,
        },
        auth.user!.id
      )
      return response.created({
        status: 'success',
        message:
          orden.status === 'recibida'
            ? `Orden ${orden.code} recibida completa`
            : `Recepción parcial ${receipt.code} registrada`,
        data: { orden, receipt, revisionesDePrecio: revisiones },
      })
    } catch (error) {
      if (error instanceof PurchaseError || error instanceof InsufficientStockError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async close({ params, business, request, response }: HttpContext) {
    try {
      const orden = await PurchaseService.cerrar(business, Number(params.id), request.input('note'))
      return { status: 'success', message: 'Orden cerrada', data: orden }
    } catch (error) {
      if (error instanceof PurchaseError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Recibe de una vez todo lo que falte: es lo que hacía el botón «Recibir». */
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
