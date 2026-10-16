import BusinessImage from '#models/business_image'
import Payment from '#models/payment'
import PaymentService, { PaymentError } from '#services/payment_service'
import StorageService from '#services/storage_service'
import type { HttpContext } from '@adonisjs/core/http'
import { readFile } from 'node:fs/promises'

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

  /**
   * Sube el comprobante de un cobro. Va al bucket pero NO a la galería del
   * negocio: devuelve la url y la clave para que `store` las guarde en el pago.
   */
  public async uploadReceipt({ request, business, response }: HttpContext) {
    const archivo = request.file('file', {
      size: `${StorageService.tamanoMaximoMb}mb`,
      extnames: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    })

    if (!archivo) {
      return response.unprocessableEntity({ status: 'error', message: 'No se recibió ninguna imagen' })
    }

    const tipo = archivo.headers['content-type'] ?? ''
    if (!archivo.isValid || !StorageService.tiposPermitidos.includes(tipo)) {
      return response.unprocessableEntity({
        status: 'error',
        message: archivo.errors[0]?.message ?? 'Formato no permitido (usa JPG, PNG o WebP)',
      })
    }

    const key = StorageService.construirKey(business.id, 'comprobante', archivo.extname ?? 'jpg')
    const url = await StorageService.subir(key, await readFile(archivo.tmpPath!), tipo)

    return response.created({ status: 'success', data: { url, key } })
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

    // Comprobante subido con `uploadReceipt`: la clave debe ser de este negocio.
    const receiptKey: string | null = request.input('receiptKey') ?? null
    let receiptUrl: string | null = null
    if (receiptKey) {
      if (!receiptKey.startsWith(`businesses/${business.id}/`) || !StorageService.keyValida(receiptKey)) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'El comprobante no pertenece a este negocio',
        })
      }
      receiptUrl = StorageService.urlPublica(receiptKey)
    }

    try {
      const { payment, order } = await PaymentService.registrar({
        businessId: business.id,
        orderId: Number(params.orderId),
        method,
        amount: Number(request.input('amount')),
        reference: request.input('reference') ?? null,
        receiptImageId,
        receiptUrl,
        receiptKey,
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
