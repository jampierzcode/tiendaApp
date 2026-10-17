import Shipment from '#models/shipment'
import ShipmentService, { ShipmentError } from '#services/shipment_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class ShipmentsController {
  public async index({ business, request }: HttpContext) {
    const query = Shipment.query()
      .where('business_id', business.id)
      .preload('events', (e) => e.orderBy('happened_at', 'asc'))
      .orderBy('id', 'desc')

    if (request.input('kind')) query.where('kind', request.input('kind'))
    if (request.input('status')) query.where('status', request.input('status'))
    if (request.input('purchaseOrderId')) {
      query.where('purchase_order_id', Number(request.input('purchaseOrderId')))
    }
    if (request.input('orderId')) query.where('order_id', Number(request.input('orderId')))

    return { status: 'success', data: await query }
  }

  public async show({ params, business }: HttpContext) {
    const envio = await Shipment.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('events', (e) => e.orderBy('happened_at', 'asc'))
      .firstOrFail()
    return { status: 'success', data: envio }
  }

  public async store({ business, auth, request, response }: HttpContext) {
    try {
      const envio = await ShipmentService.crear(
        business,
        {
          kind: request.input('kind'),
          purchaseOrderId: request.input('purchaseOrderId'),
          orderId: request.input('orderId'),
          carrier: request.input('carrier'),
          trackingCode: request.input('trackingCode'),
          trackingUrl: request.input('trackingUrl'),
          estimatedAt: request.input('estimatedAt'),
          note: request.input('note'),
        },
        auth.user!.id
      )
      return response.created({ status: 'success', message: 'Envío registrado', data: envio })
    } catch (error) {
      if (error instanceof ShipmentError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async update({ params, business, request, response }: HttpContext) {
    try {
      const envio = await ShipmentService.actualizar(business, Number(params.id), {
        carrier: request.input('carrier'),
        trackingCode: request.input('trackingCode'),
        trackingUrl: request.input('trackingUrl'),
        estimatedAt: request.input('estimatedAt'),
        note: request.input('note'),
      })
      return { status: 'success', message: 'Envío actualizado', data: envio }
    } catch (error) {
      if (error instanceof ShipmentError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async status({ params, business, auth, request, response }: HttpContext) {
    try {
      const envio = await ShipmentService.cambiarEstado(
        business,
        Number(params.id),
        request.input('status'),
        auth.user!.id,
        request.input('note'),
        request.input('at')
      )
      await envio.load('events', (e) => e.orderBy('happened_at', 'asc'))
      return { status: 'success', message: 'Estado actualizado', data: envio }
    } catch (error) {
      if (error instanceof ShipmentError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }
}
