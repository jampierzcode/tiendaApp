import Business from '#models/business'
import Subscription from '#models/subscription'
import SubscriptionService, { SubscriptionError } from '#services/subscription_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const asignarValidator = vine.compile(
  vine.object({
    planPriceId: vine.number(),
    quantity: vine.number().min(1).max(36),
    courtesy: vine.boolean().optional(),
    paymentMethod: vine.string().trim().maxLength(40).nullable().optional(),
    paymentReference: vine.string().trim().maxLength(120).nullable().optional(),
    notes: vine.string().trim().maxLength(1000).nullable().optional(),
    startsAt: vine.string().trim().nullable().optional(),
  })
)

/** Superadmin: historial y altas de planes por negocio, y el listado global de cobros. */
export default class BusinessSubscriptionsController {
  /** Historial de un negocio. */
  public async index({ params }: HttpContext) {
    const business = await Business.query()
      .where('id', params.id)
      .preload('currentPlan')
      .firstOrFail()
    const historial = await Subscription.query()
      .where('business_id', business.id)
      .preload('creator', (q) => q.select('id', 'name', 'email'))
      .orderBy('starts_at', 'desc')
      .orderBy('id', 'desc')
    return { status: 'success', data: { business, subscriptions: historial } }
  }

  /** Registra un pago: precio × cantidad de meses o años. */
  public async store({ params, request, auth, response }: HttpContext) {
    const business = await Business.findOrFail(params.id)
    const data = await request.validateUsing(asignarValidator)
    let inicio: DateTime | null = null
    if (data.startsAt) {
      inicio = DateTime.fromISO(data.startsAt)
      if (!inicio.isValid) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'Fecha de inicio inválida',
        })
      }
    }
    try {
      const sub = await SubscriptionService.asignar(
        business,
        { ...data, startsAt: inicio },
        auth.user!.id
      )
      return response.created({ status: 'success', message: 'Plan registrado', data: sub })
    } catch (error) {
      if (error instanceof SubscriptionError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Prueba gratis: alarga la vigente o abre una nueva con el plan indicado. */
  public async trial({ params, request, auth, response }: HttpContext) {
    const business = await Business.findOrFail(params.id)
    const { days, planId } = await request.validateUsing(
      vine.compile(
        vine.object({
          days: vine.number().min(1).max(90),
          planId: vine.number().nullable().optional(),
        })
      )
    )
    try {
      const sub = await SubscriptionService.extenderPrueba(
        business,
        days,
        planId ?? null,
        auth.user!.id
      )
      return { status: 'success', message: 'Prueba actualizada', data: sub }
    } catch (error) {
      if (error instanceof SubscriptionError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Anula un registro del historial (no se borra). */
  public async cancel({ params, request, response }: HttpContext) {
    const sub = await Subscription.findOrFail(params.subscriptionId)
    if (sub.status === 'cancelled') {
      return response.unprocessableEntity({ status: 'error', message: 'Ya estaba anulada' })
    }
    const motivo =
      String(request.input('reason') ?? '')
        .trim()
        .slice(0, 200) || null
    await SubscriptionService.anular(sub, motivo)
    return { status: 'success', message: 'Registro anulado', data: sub }
  }

  /**
   * Listado global de cobros con resumen: lo cobrado en el rango, negocios por
   * plan y los que vencen en los próximos 7 días.
   */
  public async all({ request }: HttpContext) {
    const desde = request.input('from')
      ? DateTime.fromISO(request.input('from')).startOf('day')
      : DateTime.now().startOf('month')
    const hasta = request.input('to')
      ? DateTime.fromISO(request.input('to')).endOf('day')
      : DateTime.now().endOf('day')

    const filas = await Subscription.query()
      .whereBetween('created_at', [desde.toSQL()!, hasta.toSQL()!])
      .preload('business', (q) => q.select('id', 'name', 'slug', 'uuid'))
      .preload('creator', (q) => q.select('id', 'name'))
      .orderBy('created_at', 'desc')

    const cobrado = filas
      .filter((s) => s.status === 'active')
      .reduce((t, s) => t + Number(s.total), 0)

    const porPlan = await db
      .from('businesses')
      .leftJoin('plans', 'plans.id', 'businesses.plan_id')
      .groupBy('plans.name', 'businesses.subscription_status')
      .select('plans.name as plan', 'businesses.subscription_status as estado')
      .count('* as total')

    const ahora = DateTime.now()
    const porVencer = await Business.query()
      .where((q) =>
        q
          .where((a) =>
            a
              .where('subscription_status', 'active')
              .whereBetween('paid_until', [ahora.toSQL()!, ahora.plus({ days: 7 }).toSQL()!])
          )
          .orWhere((t) =>
            t
              .where('subscription_status', 'trial')
              .whereBetween('trial_ends_at', [ahora.toSQL()!, ahora.plus({ days: 7 }).toSQL()!])
          )
      )
      .preload('currentPlan')
      .preload('user', (q) => q.select('id', 'name', 'email'))

    return {
      status: 'success',
      data: {
        from: desde.toISODate(),
        to: hasta.toISODate(),
        cobrado: Math.round(cobrado * 100) / 100,
        subscriptions: filas,
        porPlan: porPlan.map((r: any) => ({
          plan: r.plan ?? 'Sin plan (acceso completo)',
          estado: r.estado,
          total: Number(r.total),
        })),
        porVencer,
      },
    }
  }
}
