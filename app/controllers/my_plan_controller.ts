import Plan from '#models/plan'
import Subscription from '#models/subscription'
import { FUNCIONES } from '#services/plan_features'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

/** "Mi plan" del dueño: plan vigente, funciones, historial y planes para comparar. */
export default class MyPlanController {
  public async show({ business }: HttpContext) {
    const historial = await Subscription.query()
      .where('business_id', business.id)
      .whereNot('status', 'cancelled')
      .orderBy('starts_at', 'desc')
      .orderBy('id', 'desc')

    const planes = await Plan.query()
      .where('is_active', true)
      .where((q) => q.where('business_type', business.businessType).orWhereNull('business_type'))
      .preload('prices', (p) => p.where('is_active', true).orderBy('interval', 'asc'))
      .orderBy('sort_order', 'asc')

    return {
      status: 'success',
      data: {
        plan: business.currentPlan ?? null,
        planLabel: business.planLabel,
        legacy: !business.planId,
        subscriptionStatus: business.effectiveSubscriptionStatus,
        trialEndsAt: business.trialEndsAt,
        paidUntil: business.paidUntil,
        daysLeft: business.subscriptionDaysLeft,
        funciones: business.funciones,
        features: Object.entries(FUNCIONES).map(([key, f]) => ({ key, ...f })),
        subscriptions: historial.map((s) => ({
          id: s.id,
          planName: s.planName,
          interval: s.interval,
          quantity: s.quantity,
          unitPrice: s.unitPrice,
          subtotal: s.subtotal,
          discountType: s.discountType,
          discountValue: s.discountValue,
          discountAmount: s.discountAmount,
          total: s.total,
          currency: s.currency,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          status: s.status,
          state: s.state,
          paymentMethod: s.paymentMethod,
        })),
        plans: planes,
        soporteWhatsapp: env.get('SUPPORT_WHATSAPP') ?? null,
      },
    }
  }
}
