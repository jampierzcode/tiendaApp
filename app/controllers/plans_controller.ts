import Plan from '#models/plan'
import PlanPrice from '#models/plan_price'
import Subscription from '#models/subscription'
import { FUNCIONES, esFuncion } from '#services/plan_features'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'

const planValidator = vine.compile(
  vine.object({
    key: vine
      .string()
      .trim()
      .regex(/^[a-z0-9_]+$/)
      .maxLength(60)
      .optional(),
    name: vine.string().trim().minLength(2).maxLength(80),
    tagline: vine.string().trim().maxLength(160).nullable().optional(),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    businessType: vine.enum(['restaurant', 'retail']).nullable().optional(),
    features: vine.array(vine.string()),
    isFeatured: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
    sortOrder: vine.number().optional(),
    prices: vine
      .array(
        vine.object({
          interval: vine.enum(['month', 'year']),
          price: vine.number().min(0).max(100000),
          isActive: vine.boolean().optional(),
        })
      )
      .optional(),
  })
)

/** Planes comerciales: el superadmin los edita; el wizard y "Mi plan" los leen. */
export default class PlansController {
  /** Catálogo de funciones para armar las casillas del formulario. */
  public async features() {
    return {
      status: 'success',
      data: Object.entries(FUNCIONES).map(([key, f]) => ({ key, ...f })),
    }
  }

  /** Superadmin: todos los planes con sus precios y cuántos negocios los usan. */
  public async index() {
    const planes = await Plan.query()
      .preload('prices', (q) => q.orderBy('interval', 'asc'))
      .orderBy('business_type', 'asc')
      .orderBy('sort_order', 'asc')
    const usos = await db
      .from('businesses')
      .whereNotNull('plan_id')
      .groupBy('plan_id')
      .select('plan_id')
      .count('* as total')
    const porPlan = new Map(usos.map((u: any) => [Number(u.plan_id), Number(u.total)]))
    return {
      status: 'success',
      data: planes.map((p) => ({ ...p.serialize(), businessesCount: porPlan.get(p.id) ?? 0 })),
    }
  }

  /** Público: planes activos (para el wizard y la comparación del dueño). */
  public async publicIndex({ request }: HttpContext) {
    const tipo = request.input('business_type')
    const q = Plan.query()
      .where('is_active', true)
      .preload('prices', (p) => p.where('is_active', true).orderBy('interval', 'asc'))
      .orderBy('sort_order', 'asc')
    if (tipo) q.where((w) => w.where('business_type', tipo).orWhereNull('business_type'))
    const planes = await q
    return {
      status: 'success',
      data: {
        plans: planes.map((p) => p.serialize()),
        features: Object.entries(FUNCIONES).map(([key, f]) => ({ key, ...f })),
      },
    }
  }

  public async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(planValidator)
    const key =
      data.key ||
      data.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    if (await Plan.findBy('key', key)) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Ya existe un plan con esa clave',
      })
    }
    const plan = await db.transaction(async (trx) => {
      const p = await Plan.create(
        {
          key,
          name: data.name,
          tagline: data.tagline ?? null,
          description: data.description ?? null,
          businessType: data.businessType ?? null,
          features: data.features.filter(esFuncion),
          isFeatured: data.isFeatured ?? false,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0,
        },
        { client: trx }
      )
      await this.guardarPrecios(p.id, data.prices ?? [], trx)
      return p
    })
    await plan.load('prices')
    return response.created({ status: 'success', message: 'Plan creado', data: plan })
  }

  public async update({ params, request }: HttpContext) {
    const plan = await Plan.findOrFail(params.id)
    const data = await request.validateUsing(planValidator)
    await db.transaction(async (trx) => {
      plan.merge({
        name: data.name,
        tagline: data.tagline ?? null,
        description: data.description ?? null,
        businessType: data.businessType ?? null,
        features: data.features.filter(esFuncion),
        isFeatured: data.isFeatured ?? plan.isFeatured,
        isActive: data.isActive ?? plan.isActive,
        sortOrder: data.sortOrder ?? plan.sortOrder,
      })
      await plan.useTransaction(trx).save()
      if (data.prices) await this.guardarPrecios(plan.id, data.prices, trx)
    })
    await plan.load('prices')
    return { status: 'success', message: 'Plan actualizado', data: plan }
  }

  /** Solo se borra un plan que nunca se vendió; si no, se desactiva. */
  public async destroy({ params, response }: HttpContext) {
    const plan = await Plan.findOrFail(params.id)
    const usado = await Subscription.query().where('plan_id', plan.id).first()
    if (usado) {
      return response.unprocessableEntity({
        status: 'error',
        message:
          'Este plan ya tiene suscripciones en el historial. Desactívalo en vez de borrarlo.',
      })
    }
    await plan.delete()
    return { status: 'success', message: 'Plan eliminado' }
  }

  /**
   * Un precio por intervalo. Cambiar el monto no altera lo ya cobrado: cada
   * suscripción guarda su propio precio unitario y total.
   */
  private async guardarPrecios(
    planId: number,
    precios: { interval: 'month' | 'year'; price: number; isActive?: boolean }[],
    trx: any
  ) {
    for (const p of precios) {
      const existente = await PlanPrice.query({ client: trx })
        .where('plan_id', planId)
        .where('interval', p.interval)
        .first()
      if (existente) {
        existente.merge({ price: p.price, isActive: p.isActive ?? true })
        await existente.useTransaction(trx).save()
      } else {
        await PlanPrice.create(
          {
            planId,
            interval: p.interval,
            price: p.price,
            currency: 'PEN',
            isActive: p.isActive ?? true,
          },
          { client: trx }
        )
      }
    }
  }
}
