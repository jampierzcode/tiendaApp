import Order from '#models/order'
import Payment, { type MetodoPago } from '#models/payment'
import PricingService from '#services/pricing_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export class PaymentError extends Error {}

interface EntradaPago {
  businessId: number
  orderId: number
  method: MetodoPago
  amount: number
  reference?: string | null
  receiptImageId?: number | null
  note?: string | null
  paidAt?: DateTime
  userId?: number | null
}

/**
 * Registro de cobros.
 *
 * Todo pago pasa por aquí porque `orders.paid_total` es un total cacheado: si
 * alguien inserta una fila en `payments` por su cuenta, el pedido dice que
 * sigue debiendo. Mismo patrón que el kardex con el stock.
 */
export default class PaymentService {
  static async registrar(entrada: EntradaPago) {
    return db.transaction(async (trx) => {
      const order = await Order.query({ client: trx })
        .where('id', entrada.orderId)
        .andWhere('business_id', entrada.businessId)
        .forUpdate()
        .firstOrFail()

      if (['cancelado', 'devuelto'].includes(order.status)) {
        throw new PaymentError(`No se pueden registrar pagos de un pedido ${order.status}`)
      }

      const monto = PricingService.redondear(Number(entrada.amount))

      if (!Number.isFinite(monto) || monto <= 0) {
        throw new PaymentError('El monto debe ser mayor que cero')
      }

      const saldo = PricingService.redondear(Number(order.total) - Number(order.paidTotal))

      // Un céntimo de tolerancia: los redondeos de porcentajes no tienen por
      // qué cuadrar al último decimal.
      if (monto > saldo + 0.01) {
        throw new PaymentError(
          `El pago excede el saldo pendiente de ${saldo.toFixed(2)}`
        )
      }

      const payment = await Payment.create(
        {
          businessId: entrada.businessId,
          orderId: order.id,
          method: entrada.method,
          amount: monto,
          reference: entrada.reference ?? null,
          receiptImageId: entrada.receiptImageId ?? null,
          note: entrada.note ?? null,
          paidAt: entrada.paidAt ?? DateTime.now(),
          userId: entrada.userId ?? null,
        },
        { client: trx }
      )

      await this.refrescarTotal(order, trx)

      return { payment, order }
    })
  }

  /**
   * Anula un cobro mal registrado. Se borra la fila en vez de guardar un
   * contra-asiento porque, a diferencia del inventario, aquí no hay saldo
   * histórico que reconstruir: el total se recalcula sumando lo que queda.
   */
  static async anular(businessId: number, paymentId: number) {
    return db.transaction(async (trx) => {
      const payment = await Payment.query({ client: trx })
        .where('id', paymentId)
        .andWhere('business_id', businessId)
        .firstOrFail()

      const order = await Order.query({ client: trx })
        .where('id', payment.orderId)
        .forUpdate()
        .firstOrFail()

      await payment.useTransaction(trx).delete()
      await this.refrescarTotal(order, trx)

      return order
    })
  }

  /** Recalcula el pagado del pedido y ajusta su estado si quedó saldado. */
  private static async refrescarTotal(order: Order, trx: any) {
    const fila = await trx
      .from('payments')
      .where('order_id', order.id)
      .sum('amount as total')
      .first()

    const pagado = PricingService.redondear(Number(fila?.total ?? 0))
    order.paidTotal = pagado

    const saldado = pagado >= Number(order.total) - 0.01

    // El estado sube a "pagado" solo desde confirmado: un pedido ya enviado
    // no debe retroceder por registrar el cobro contra entrega.
    if (saldado && order.status === 'confirmado') {
      order.status = 'pagado'
    }

    // Si se anuló el cobro que lo había saldado, vuelve a confirmado.
    if (!saldado && order.status === 'pagado') {
      order.status = 'confirmado'
    }

    order.useTransaction(trx)
    await order.save()
  }
}
