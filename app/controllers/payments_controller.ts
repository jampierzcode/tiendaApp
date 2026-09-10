import BusinessImage from '#models/business_image'
import Payment from '#models/payment'
import PaymentService, { PaymentError } from '#services/payment_service'
import type { HttpContext } from '@adonisjs/core/http'

const METODOS = ['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta', 'otro'] as const

export default class PaymentsController {
  /** Historial de cobros de un pedido. */
  public async index({ params, business }: HttpContext) {
    const pagos = await Payment.query()
      .where('business_id', business.id)
      .andWhere('order_id', params.orderId)
      .preload('receipt')
      .preload('user', (u) => u.select('id', 'name'))
      .orderBy('paid_at', 'desc')

    return { status: 'success', data: pagos }
  }

  public async store({ params, request, business, auth, response }: HttpContext) {
    const method = request.input('method')
    const receiptImageId = request.input('receiptImageId') ?? null

    if (!METODOS.includes(method)) {
      return response.unprocessableEntity({
        status: 'error',
        message: `El método debe ser uno de: ${METODOS.join(', ')}`,
      })
    }

    // El comprobante tiene que ser de la galería de este negocio.
    if (receiptImageId) {
      const imagen = await BusinessImage.query()
        .where('id', receiptImageId)
        .andWhere('business_id', business.id)
        .first()

      if (!imagen) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'El comprobante no pertenece a este negocio',
        })
      }
    }

    try {
      const { payment, order } = await PaymentService.registrar({
        businessId: business.id,
        orderId: Number(params.orderId),
        method,
        amount: Number(request.input('amount')),
        reference: request.input('reference') ?? null,
        receiptImageId,
        note: request.input('note') ?? null,
        userId: auth.user!.id,
      })

      return response.created({
        status: 'success',
        message: 'Pago registrado',
        data: { payment, order },
      })
    } catch (error) {
      if (error instanceof PaymentError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async destroy({ params, business }: HttpContext) {
    const order = await PaymentService.anular(business.id, Number(params.id))
    return { status: 'success', message: 'Pago anulado', data: order }
  }
}
