import Business from '#models/business'
import Plan from '#models/plan'
import PlanPrice from '#models/plan_price'
import Subscription from '#models/subscription'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

export class SubscriptionError extends Error {}

export type AsignarInput = {
  planPriceId: number
  /** Cuántos meses (precio mensual) o años (precio anual). */
  quantity: number
  /** Sin cobro: queda en el historial con total 0. */
  courtesy?: boolean
  /** Precio pactado por mes/año para este cliente; si no, el de lista. */
  unitPrice?: number | null
  /** Descuento sobre el subtotal: porcentaje (0–100) o monto en soles. */
  discountType?: 'percent' | 'amount' | null
  discountValue?: number | null
  paymentMethod?: string | null
  paymentReference?: string | null
  notes?: string | null
  /** Forzar el inicio; si no, se calcula (renovación o cambio de plan). */
  startsAt?: DateTime | null
}

/**
 * Altas, renovaciones, pruebas y anulaciones de planes.
 *
 * Las filas de `subscriptions` son la verdad; `businesses` guarda un resumen
 * (plan vigente, estado, vencimiento) que `sincronizar` recalcula después de
 * cada cambio para que el resto de la app siga leyendo los mismos campos.
 */
export default class SubscriptionService {
  /**
   * Registra un período pagado: precio del intervalo × cantidad.
   *
   * - Mismo plan y todavía vigente → se suma al final (renovación).
   * - Otro plan → empieza ahora y el período vigente se cierra hoy (cambio de plan).
   */
  static async asignar(business: Business, input: AsignarInput, userId: number | null) {
    const precio = await PlanPrice.query().where('id', input.planPriceId).preload('plan').first()
    if (!precio || !precio.plan) throw new SubscriptionError('El precio elegido no existe')
    const cantidad = Math.floor(Number(input.quantity))
    const maximo = precio.interval === 'year' ? 5 : 36
    if (!(cantidad >= 1 && cantidad <= maximo)) {
      throw new SubscriptionError(
        `La cantidad debe estar entre 1 y ${maximo} ${precio.interval === 'year' ? 'años' : 'meses'}`
      )
    }

    return db.transaction(async (trx) => {
      const ahora = DateTime.now()
      const abiertas = await Subscription.query({ client: trx })
        .where('business_id', business.id)
        .whereNot('status', 'cancelled')
        .where('ends_at', '>', ahora.toSQL()!)
        .orderBy('ends_at', 'desc')

      let inicio = input.startsAt ?? ahora
      if (!input.startsAt) {
        const mismoPlanPagado = abiertas.filter(
          (s) => s.status === 'active' && s.planId === precio.planId
        )
        if (mismoPlanPagado.length) {
          inicio = mismoPlanPagado[0].endsAt
        } else {
          // Cambio de plan (o salida de la prueba): lo anterior termina hoy.
          for (const s of abiertas) {
            if (s.startsAt > ahora) {
              s.status = 'cancelled'
              s.cancelledAt = ahora
              s.notes = [s.notes, 'Anulada por cambio de plan'].filter(Boolean).join(' · ')
            } else {
              s.endsAt = ahora
            }
            await s.useTransaction(trx).save()
          }
        }
      }

      const fin =
        precio.interval === 'year'
          ? inicio.plus({ years: cantidad })
          : inicio.plus({ months: cantidad })
      const unitario = input.courtesy
        ? 0
        : input.unitPrice !== undefined && input.unitPrice !== null
          ? Math.round(Number(input.unitPrice) * 100) / 100
          : Number(precio.price)

      const { subtotal, descuento, total } = this.calcularTotal(
        unitario,
        cantidad,
        input.discountType ?? null,
        input.discountValue ?? null
      )

      const sub = await Subscription.create(
        {
          businessId: business.id,
          planId: precio.planId,
          planPriceId: precio.id,
          planName: precio.plan.name,
          interval: precio.interval,
          quantity: cantidad,
          unitPrice: unitario,
          subtotal,
          discountType: descuento > 0 ? input.discountType! : null,
          discountValue: descuento > 0 ? Number(input.discountValue) : null,
          discountAmount: descuento,
          total,
          currency: precio.currency,
          startsAt: inicio,
          endsAt: fin,
          status: 'active',
          paymentMethod: input.courtesy ? 'cortesia' : (input.paymentMethod ?? null),
          paymentReference: input.paymentReference ?? null,
          notes: input.notes ?? null,
          createdBy: userId,
        },
        { client: trx }
      )

      await this.sincronizar(business, trx)
      return sub
    })
  }

  /**
   * Subtotal, descuento y total en soles (redondeados a céntimos). El
   * descuento nunca deja el total por debajo de cero.
   */
  static calcularTotal(
    unitario: number,
    cantidad: number,
    tipo: 'percent' | 'amount' | null,
    valor: number | null
  ) {
    const r = (n: number) => Math.round(n * 100) / 100
    const subtotal = r(unitario * cantidad)
    let descuento = 0
    if (tipo && valor && valor > 0) {
      if (tipo === 'percent' && valor > 100) {
        throw new SubscriptionError('El descuento no puede pasar del 100 %')
      }
      descuento = tipo === 'percent' ? r((subtotal * valor) / 100) : r(valor)
      if (descuento > subtotal) {
        throw new SubscriptionError('El descuento no puede ser mayor que el subtotal')
      }
    }
    return { subtotal, descuento, total: r(subtotal - descuento) }
  }

  /** Prueba gratis de un plan (la usa el alta de negocios y el superadmin). */
  static async iniciarPrueba(
    business: Business,
    plan: Plan,
    dias: number,
    userId: number | null,
    trx?: TransactionClientContract
  ) {
    const ahora = DateTime.now()
    const sub = await Subscription.create(
      {
        businessId: business.id,
        planId: plan.id,
        planPriceId: null,
        planName: plan.name,
        interval: 'trial',
        quantity: dias,
        unitPrice: 0,
        subtotal: 0,
        discountAmount: 0,
        total: 0,
        currency: 'PEN',
        startsAt: ahora,
        endsAt: ahora.plus({ days: dias }),
        status: 'trial',
        createdBy: userId,
      },
      { client: trx }
    )
    await this.sincronizar(business, trx)
    return sub
  }

  /** Alarga la prueba vigente o abre una nueva con el plan indicado. */
  static async extenderPrueba(
    business: Business,
    dias: number,
    planId: number | null,
    userId: number
  ) {
    return db.transaction(async (trx) => {
      const ahora = DateTime.now()
      const vigente = await Subscription.query({ client: trx })
        .where('business_id', business.id)
        .where('status', 'trial')
        .where('ends_at', '>', ahora.toSQL()!)
        .orderBy('ends_at', 'desc')
        .first()

      if (vigente && (!planId || planId === vigente.planId)) {
        vigente.endsAt = vigente.endsAt.plus({ days: dias })
        vigente.quantity += dias
        await vigente.useTransaction(trx).save()
        await this.sincronizar(business, trx)
        return vigente
      }

      const plan = planId
        ? await Plan.find(planId, { client: trx })
        : business.planId
          ? await Plan.find(business.planId, { client: trx })
          : null
      if (!plan) throw new SubscriptionError('Elige el plan de la prueba')
      return this.iniciarPrueba(business, plan, dias, userId, trx)
    })
  }

  /** Anula un registro (error de carga, devolución). Queda en el historial. */
  static async anular(sub: Subscription, motivo: string | null) {
    return db.transaction(async (trx) => {
      sub.status = 'cancelled'
      sub.cancelledAt = DateTime.now()
      if (motivo) sub.notes = [sub.notes, `Anulada: ${motivo}`].filter(Boolean).join(' · ')
      await sub.useTransaction(trx).save()
      const business = await Business.findOrFail(sub.businessId, { client: trx })
      await this.sincronizar(business, trx)
      return sub
    })
  }

  /**
   * Recalcula el resumen del negocio a partir de su historial. Un negocio sin
   * ninguna suscripción (anterior a los planes) se deja como está.
   */
  static async sincronizar(business: Business, trx?: TransactionClientContract) {
    const ahora = DateTime.now()
    const filas = await Subscription.query({ client: trx })
      .where('business_id', business.id)
      .whereNot('status', 'cancelled')
      .orderBy('ends_at', 'desc')

    if (!filas.length) {
      // Todo anulado: vuelve a como estaba antes de los planes, pero vencido
      // si alguna vez tuvo plan (no se regala acceso por anular).
      const tuvo = await Subscription.query({ client: trx })
        .where('business_id', business.id)
        .first()
      if (tuvo) {
        business.subscriptionStatus = 'expired'
      }
      if (trx) business.useTransaction(trx)
      await business.save()
      return
    }

    const vigentes = filas.filter((s) => s.startsAt <= ahora && s.endsAt > ahora)
    const pagadas = filas.filter((s) => s.status === 'active')
    const actual =
      vigentes.find((s) => s.status === 'active') ??
      vigentes.find((s) => s.status === 'trial') ??
      filas[0]

    business.planId = actual.planId
    business.planLabel = actual.planName

    if (actual.status === 'active' && actual.endsAt > ahora) {
      business.subscriptionStatus = 'active'
      business.paidUntil = pagadas.reduce(
        (max, s) => (s.endsAt > max ? s.endsAt : max),
        actual.endsAt
      )
    } else if (actual.status === 'trial' && actual.endsAt > ahora) {
      business.subscriptionStatus = 'trial'
      business.trialEndsAt = actual.endsAt
    } else {
      business.subscriptionStatus = 'expired'
      if (actual.status === 'active') business.paidUntil = actual.endsAt
      else business.trialEndsAt = actual.endsAt
    }

    if (trx) business.useTransaction(trx)
    await business.save()
  }
}
