import PaymentProof from '#models/payment_proof'
import PaymentProofService, { ProofError } from '#services/payment_proof_service'
import type { HttpContext } from '@adonisjs/core/http'

/** Comprobantes que llegaron por WhatsApp: listar, validar o rechazar. */
export default class PaymentProofsController {
  public async index({ business, request }: HttpContext) {
    const q = PaymentProof.query()
      .where('business_id', business.id)
      .preload('order', (o) => o.select('id', 'code', 'customer_name', 'total', 'paid_total', 'status'))
      .orderBy('id', 'desc')
      .limit(100)
    const estado = request.input('status', 'por_validar')
    if (estado !== 'todos') q.where('status', estado)
    if (request.input('orderId')) q.where('order_id', Number(request.input('orderId')))
    return { status: 'success', data: await q }
  }

  public async validate({ business, params, request, auth, response }: HttpContext) {
    try {
      const proof = await PaymentProofService.validar(
        business,
        Number(params.id),
        {
          amount: request.input('amount'),
          method: request.input('method'),
          reference: request.input('reference'),
          orderId: request.input('orderId'),
        },
        auth.user!.id
      )
      return { status: 'success', message: 'Pago validado y registrado', data: proof }
    } catch (error) {
      if (error instanceof ProofError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  public async reject({ business, params, request, auth, response }: HttpContext) {
    try {
      const proof = await PaymentProofService.rechazar(
        business,
        Number(params.id),
        String(request.input('reason') ?? ''),
        auth.user!.id
      )
      return { status: 'success', message: 'Comprobante rechazado', data: proof }
    } catch (error) {
      if (error instanceof ProofError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }
}
