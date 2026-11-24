import type Business from '#models/business'
import Notification from '#models/notification'
import Order from '#models/order'
import PaymentProof from '#models/payment_proof'
import type { MetodoPago } from '#models/payment'
import NotificationService from '#services/notification_service'
import PaymentService, { PaymentError } from '#services/payment_service'
import PricingService from '#services/pricing_service'
import PushService from '#services/push_service'
import StorageService from '#services/storage_service'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

export class ProofError extends Error {}

const METODOS: MetodoPago[] = ['yape', 'plin', 'transferencia', 'efectivo', 'tarjeta', 'otro']
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Lo que leyó el vendedor IA en la foto del comprobante. */
export interface LecturaComprobante {
  monto: number | null
  metodo: string | null
  numeroOperacion: string | null
  fecha: string | null
  titular: string | null
  observacion: string | null
}

/**
 * Comprobantes de pago que manda el comprador por WhatsApp.
 *
 * El vendedor IA nunca da un pago por recibido: guarda la foto con lo que
 * leyó, la deja «por validar» y avisa al dueño en Notificaciones. El cobro
 * real (`payments`) nace recién cuando el dueño lo valida.
 */
export default class PaymentProofService {
  static metodo(crudo: string | null | undefined): MetodoPago {
    const t = String(crudo ?? '').toLowerCase()
    if (t.includes('yape')) return 'yape'
    if (t.includes('plin')) return 'plin'
    if (/transf|bcp|bbva|interbank|scotia|banco|deposit/.test(t)) return 'transferencia'
    if (/tarjeta|visa|master/.test(t)) return 'tarjeta'
    return METODOS.includes(t as MetodoPago) ? (t as MetodoPago) : 'otro'
  }

  /** Lo que el comprador debería pagar ahora: el adelanto mínimo o el saldo. */
  static saldo(order: Order) {
    return PricingService.redondear(Number(order.total) - Number(order.paidTotal))
  }

  static async desdeChat(
    business: Business,
    phone: string,
    imagen: { mime: string; data: string },
    lectura: LecturaComprobante,
    codigoPedido: string | null
  ) {
    const digitos = phone.replace(/\D/g, '').slice(-9)

    // Pedido: el que nombró el comprador (si es suyo) o el último con saldo.
    const base = () =>
      Order.query()
        .where('business_id', business.id)
        .andWhere('customer_phone', 'like', `%${digitos}`)
        .whereNotIn('status', ['cancelado', 'devuelto'])
    let order = codigoPedido
      ? await base().andWhere('code', codigoPedido.trim().toUpperCase()).first()
      : null
    if (!order) {
      order = await base().whereRaw('total - paid_total > 0.01').orderBy('id', 'desc').first()
    }

    const operacion = lectura.numeroOperacion?.replace(/\s/g, '').slice(0, 60) || null
    if (operacion) {
      const repetido = await PaymentProof.query()
        .where('business_id', business.id)
        .andWhere('operation_code', operacion)
        .andWhereNot('status', 'rechazado')
        .first()
      if (repetido) {
        return { repetido: true as const, proof: repetido, order }
      }
    }

    const mime = EXTENSION[imagen.mime] ? imagen.mime : 'image/jpeg'
    const key = StorageService.construirKey(business.id, 'comprobante', EXTENSION[mime])
    const url = await StorageService.subir(key, Buffer.from(imagen.data, 'base64'), mime)

    const esperado = order ? this.saldo(order) : null
    const monto =
      lectura.monto !== null && Number.isFinite(Number(lectura.monto))
        ? PricingService.redondear(Number(lectura.monto))
        : null

    const proof = await PaymentProof.create({
      businessId: business.id,
      orderId: order?.id ?? null,
      phone: phone.replace(/\D/g, '').slice(0, 30),
      imageUrl: url,
      imageKey: key,
      amount: monto,
      method: lectura.metodo ? this.metodo(lectura.metodo) : null,
      operationCode: operacion,
      paidAtText: lectura.fecha?.slice(0, 60) || null,
      payerName: lectura.titular?.slice(0, 120) || null,
      aiNote: lectura.observacion?.slice(0, 1000) || null,
      status: 'por_validar',
    })

    await this.avisarDueno(business, proof, order)
    return { repetido: false as const, proof, order, esperado }
  }

  /** Comprobantes que este número mandó en los últimos días (los que no se rechazaron). */
  static async recientes(businessId: number, telefonos: string[], dias = 3) {
    const finales = [
      ...new Set(telefonos.map((t) => t.replace(/\D/g, '').slice(-9)).filter(Boolean)),
    ]
    if (!finales.length) return []
    return PaymentProof.query()
      .where('business_id', businessId)
      .andWhereNot('status', 'rechazado')
      .andWhere('created_at', '>', DateTime.now().minus({ days: dias }).toSQL()!)
      .andWhere((q) => {
        for (const f of finales) q.orWhere('phone', 'like', `%${f}`)
      })
      .preload('order')
      .orderBy('id', 'asc')
  }

  /**
   * El comprador pagó el adelanto ANTES de que existiera el pedido (el chat
   * se lo pidió): al crearse el pedido, esos comprobantes sueltos son suyos.
   */
  static async vincularSueltos(business: Business, telefonos: string[], order: Order) {
    const recientes = await this.recientes(business.id, telefonos, 2)
    const sueltos = recientes.filter((p) => p.orderId === null && p.status === 'por_validar')
    if (!sueltos.length) return []
    const simbolo = business.currencySymbol || 'S/'
    for (const p of sueltos) {
      p.orderId = order.id
      await p.save()
    }
    try {
      const total = sueltos.reduce((t, p) => t + Number(p.amount ?? 0), 0)
      await Notification.create({
        businessId: business.id,
        type: 'pedido',
        orderId: order.id,
        title: `Comprobante por validar · ${order.code}`,
        body: `${order.customerName ?? ''} · ${simbolo} ${total.toFixed(2)} enviado antes del pedido`
          .replace(/^ · /, '')
          .slice(0, 250),
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar el comprobante asociado')
    }
    return sueltos
  }

  private static async avisarDueno(business: Business, proof: PaymentProof, order: Order | null) {
    const simbolo = business.currencySymbol || 'S/'
    const titulo = order
      ? `Comprobante por validar · ${order.code}`
      : 'Comprobante sin pedido por validar'
    const cuerpo = [
      order?.customerName ?? proof.phone,
      proof.amount !== null && `${simbolo} ${proof.amount.toFixed(2)}`,
      proof.method,
      proof.operationCode && `Op. ${proof.operationCode}`,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 250)
    try {
      await Notification.create({
        businessId: business.id,
        type: 'pedido',
        orderId: order?.id ?? null,
        title: titulo,
        body: cuerpo,
      })
      await PushService.enviar(business.userId, {
        title: titulo,
        body: cuerpo,
        url: order
          ? `/b/${business.uuid}/orders?pedido=${order.id}`
          : `/b/${business.uuid}/orders?comprobantes=1`,
        tag: `comprobante-${proof.id}`,
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar el comprobante al dueño')
    }
  }

  /** Valida: registra el cobro con la foto como comprobante y avisa al comprador. */
  static async validar(
    business: Business,
    id: number,
    datos: { amount?: number; method?: string; reference?: string | null; orderId?: number | null },
    userId: number
  ) {
    const proof = await PaymentProof.query()
      .where('id', id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    if (proof.status !== 'por_validar') throw new ProofError('Este comprobante ya fue revisado')

    const orderId = datos.orderId ?? proof.orderId
    if (!orderId) throw new ProofError('Elige el pedido al que corresponde este pago')
    const order = await Order.query()
      .where('id', orderId)
      .andWhere('business_id', business.id)
      .first()
    if (!order) throw new ProofError('El pedido no pertenece a esta tienda')

    const monto = Number(datos.amount ?? proof.amount)
    if (!Number.isFinite(monto) || monto <= 0) throw new ProofError('Indica el monto pagado')

    let resultado
    try {
      resultado = await PaymentService.registrar({
        businessId: business.id,
        orderId: order.id,
        method: this.metodo(datos.method ?? proof.method),
        amount: monto,
        reference: datos.reference ?? proof.operationCode,
        receiptUrl: proof.imageUrl,
        receiptKey: proof.imageKey,
        note: 'Comprobante enviado por WhatsApp',
        userId,
      })
    } catch (error) {
      if (error instanceof PaymentError) throw new ProofError(error.message)
      throw error
    }

    proof.merge({
      orderId: order.id,
      paymentId: resultado.payment.id,
      amount: monto,
      status: 'validado',
      reviewedAt: DateTime.now(),
      reviewedBy: userId,
    })
    await proof.save()

    const actualizado = resultado.order
    const simbolo = business.currencySymbol || 'S/'
    const debe = this.saldo(actualizado)
    await NotificationService.avisoLibre(
      business,
      actualizado,
      'pago_validado',
      `✅ ${actualizado.customerName}, validamos tu pago de *${simbolo} ${monto.toFixed(2)}* para el pedido *${actualizado.code}*.` +
        (debe > 0.01
          ? ` Queda un saldo de ${simbolo} ${debe.toFixed(2)}.`
          : ' ¡Tu pedido está pagado! 🙌')
    ).catch(() => undefined)

    return proof
  }

  static async rechazar(business: Business, id: number, motivo: string, userId: number) {
    const proof = await PaymentProof.query()
      .where('id', id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    if (proof.status !== 'por_validar') throw new ProofError('Este comprobante ya fue revisado')
    const razon = motivo?.trim().slice(0, 255) || 'No pudimos verificar el pago'
    proof.merge({
      status: 'rechazado',
      rejectReason: razon,
      reviewedAt: DateTime.now(),
      reviewedBy: userId,
    })
    await proof.save()

    if (proof.orderId) {
      const order = await Order.find(proof.orderId)
      if (order) {
        await NotificationService.avisoLibre(
          business,
          order,
          'pago_rechazado',
          `Hola ${order.customerName}, no pudimos validar el comprobante que enviaste para el pedido *${order.code}*: ${razon}. ¿Nos ayudas revisándolo o enviando otro?`
        ).catch(() => undefined)
      }
    }
    return proof
  }
}
