import Category from '#models/category'
import Discount from '#models/discount'
import DiscountTarget from '#models/discount_target'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import PromotionService from '#services/promotion_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

type Destino = { kind: 'product' | 'variation' | 'category'; id: number }

/**
 * Promociones de la tienda: descuentos por porcentaje o monto, «lleva N paga M»
 * y cupones con código. Aplican a toda la tienda o a una selección de
 * productos, variaciones y categorías, y pueden ser recurrentes por día de la
 * semana (por ejemplo, todos los viernes y sábados de este mes).
 */
export default class DiscountsController {
  private static datos(request: HttpContext['request']) {
    const b = request.only([
      'name',
      'kind',
      'value',
      'buy_qty',
      'pay_qty',
      'scope',
      'targets',
      'product_id',
      'category_id',
      'weekdays',
      'code',
      'is_active',
      'start_date',
      'end_date',
    ])
    const vacio = (v: unknown) => v === undefined || v === null || v === ''

    // Formato anterior (un producto o categoría suelto) → una selección de un destino.
    const destinos: Destino[] = []
    if (Array.isArray(b.targets)) {
      for (const t of b.targets) {
        if (['product', 'variation', 'category'].includes(t?.kind) && Number(t?.id) > 0) {
          destinos.push({ kind: t.kind, id: Number(t.id) })
        }
      }
    }
    if (b.scope === 'product' && !vacio(b.product_id)) destinos.push({ kind: 'product', id: Number(b.product_id) })
    if (b.scope === 'category' && !vacio(b.category_id)) destinos.push({ kind: 'category', id: Number(b.category_id) })

    const unicos = new Map(destinos.map((d) => [`${d.kind}:${d.id}`, d]))
    const dias = Array.isArray(b.weekdays) ? [...new Set(b.weekdays.map(Number))].sort((a, c) => a - c) : []

    return {
      name: String(b.name ?? '').trim(),
      kind: b.kind,
      value: b.kind === 'bundle' ? 0 : Number(b.value),
      buyQty: b.kind === 'bundle' ? Number(b.buy_qty) : null,
      payQty: b.kind === 'bundle' ? Number(b.pay_qty) : null,
      scope: b.scope === 'all' ? 'all' : 'selection',
      targets: b.scope === 'all' ? [] : [...unicos.values()],
      weekdays: dias,
      code: vacio(b.code) ? null : String(b.code).trim().toUpperCase().replace(/\s+/g, ''),
      isActive: b.is_active === undefined ? true : b.is_active === true || b.is_active === 'true',
      startDate: vacio(b.start_date) ? null : String(b.start_date).slice(0, 10),
      endDate: vacio(b.end_date) ? null : String(b.end_date).slice(0, 10),
    }
  }

  private static async revisar(
    business: HttpContext['business'],
    d: ReturnType<typeof DiscountsController.datos>,
    excluirId?: number
  ) {
    const error = PromotionService.validar(d)
    if (error) return error

    // Cada destino tiene que ser de este negocio: si no, una promoción podría
    // colgarse de productos de otra tienda.
    for (const [kind, modelo] of [
      ['product', Product],
      ['variation', ProductVariation],
      ['category', Category],
    ] as const) {
      const ids = d.targets.filter((t) => t.kind === kind).map((t) => t.id)
      if (!ids.length) continue
      const validos = await (modelo as typeof Product)
        .query()
        .where('business_id', business.id)
        .whereIn('id', ids)
        .count('* as total')
        .first()
      if (Number(validos?.$extras.total ?? 0) !== ids.length) {
        return kind === 'category'
          ? 'Alguna categoría no pertenece a este negocio'
          : kind === 'variation'
            ? 'Alguna variación no pertenece a este negocio'
            : 'Algún producto no pertenece a este negocio'
      }
    }

    if (d.code && !/^[A-Z0-9_-]{3,40}$/.test(d.code)) {
      return 'El código solo lleva letras, números, guion o guion bajo (mínimo 3)'
    }
    if (d.code) {
      const q = Discount.query()
        .where('business_id', business.id)
        .whereRaw('lower(code) = ?', [d.code.toLowerCase()])
      if (excluirId) q.whereNot('id', excluirId)
      if (await q.first()) return 'Ya tienes un cupón con ese código'
    }
    return null
  }

  private static serializar(p: Discount, nombres?: Map<string, string>) {
    return {
      ...p.serialize(),
      weekdays: p.dias,
      diasTexto: PromotionService.diasTexto(p),
      label: PromotionService.etiqueta(p),
      targets: (p.targets ?? []).map((t) => ({
        kind: t.kind,
        id: t.targetId,
        name: nombres?.get(`${t.kind}:${t.targetId}`) ?? null,
      })),
    }
  }

  private static async guardarDestinos(
    trx: any,
    businessId: number,
    discountId: number,
    destinos: Destino[]
  ) {
    await trx.from('discount_targets').where('discount_id', discountId).delete()
    for (const t of destinos) {
      await DiscountTarget.create(
        { businessId, discountId, kind: t.kind, targetId: t.id },
        { client: trx }
      )
    }
  }

  public async index({ business }: HttpContext) {
    const lista = await Discount.query()
      .where('business_id', business.id)
      .preload('targets')
      .orderBy('id', 'desc')

    const nombres = await PromotionService.nombresDestinos(business.id, lista)
    const ahora = await PromotionService.ahoraDe(business.id)

    return {
      status: 'success',
      data: lista.map((p) => ({
        ...DiscountsController.serializar(p, nombres),
        vigente: PromotionService.vigente(p, ahora),
      })),
    }
  }

  public async store({ request, business, response }: HttpContext) {
    const d = DiscountsController.datos(request)
    const error = await DiscountsController.revisar(business, d)
    if (error) return response.unprocessableEntity({ status: 'error', message: error })

    const promo = await db.transaction(async (trx) => {
      const creada = await Discount.create(
        {
          businessId: business.id,
          name: d.name,
          kind: d.kind,
          value: d.value,
          buyQty: d.buyQty,
          payQty: d.payQty,
          scope: d.scope,
          code: d.code,
          isActive: d.isActive,
          startDate: d.startDate,
          endDate: d.endDate,
          weekdays: d.weekdays.length ? d.weekdays.join(',') : null,
        } as any,
        { client: trx }
      )
      await DiscountsController.guardarDestinos(trx, business.id, creada.id, d.targets)
      return creada
    })

    await promo.load('targets')
    return { status: 'success', message: 'Promoción creada', data: DiscountsController.serializar(promo) }
  }

  public async update({ params, request, business, response }: HttpContext) {
    const promo = await Discount.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const d = DiscountsController.datos(request)
    const error = await DiscountsController.revisar(business, d, promo.id)
    if (error) return response.unprocessableEntity({ status: 'error', message: error })

    await db.transaction(async (trx) => {
      promo.useTransaction(trx)
      promo.merge({
        name: d.name,
        kind: d.kind,
        value: d.value,
        buyQty: d.buyQty,
        payQty: d.payQty,
        scope: d.scope,
        code: d.code,
        isActive: d.isActive,
        startDate: d.startDate,
        endDate: d.endDate,
        weekdays: d.weekdays.length ? d.weekdays.join(',') : null,
        productId: null,
        categoryId: null,
      } as any)
      await promo.save()
      await DiscountsController.guardarDestinos(trx, business.id, promo.id, d.targets)
    })

    await promo.load('targets')
    return { status: 'success', message: 'Promoción actualizada', data: DiscountsController.serializar(promo) }
  }

  /** Prende o apaga una promoción sin borrarla. */
  public async toggle({ params, request, business }: HttpContext) {
    const promo = await Discount.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('targets')
      .firstOrFail()

    promo.isActive = request.input('is_active') === true
    await promo.save()
    return {
      status: 'success',
      message: promo.isActive ? 'Promoción activada' : 'Promoción pausada',
      data: DiscountsController.serializar(promo),
    }
  }

  public async destroy({ params, business }: HttpContext) {
    const discount = await Discount.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    await discount.delete()

    return { status: 'success', message: 'Promoción eliminada' }
  }
}
