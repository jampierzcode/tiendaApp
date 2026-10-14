import Ingredient from '#models/ingredient'
import IngredientMovement from '#models/ingredient_movement'
import IngredientService from '#services/ingredient_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

const UNIDADES = ['kg', 'g', 'l', 'ml', 'und', 'porcion']

/**
 * Insumos del restaurante: lo que realmente se compra y se agota.
 */
export default class IngredientsController {
  public async index({ business, request }: HttpContext) {
    const search = String(request.input('search') ?? '').trim()

    const query = Ingredient.query().where('business_id', business.id).orderBy('name', 'asc')
    if (search) query.whereILike('name', `%${search}%`)

    const filas = await query

    const usos = await db
      .from('recipe_lines')
      .where('business_id', business.id)
      .groupBy('ingredient_id')
      .select('ingredient_id')
      .count('* as total')
    const usoPorInsumo = new Map(usos.map((u: any) => [u.ingredient_id, Number(u.total)]))

    return {
      status: 'success',
      data: filas.map((i) => ({
        ...i.serialize(),
        stock: Number(i.stock),
        minStock: Number(i.minStock),
        avgCost: Number(i.avgCost),
        value: Math.round(Math.max(Number(i.stock), 0) * Number(i.avgCost) * 100) / 100,
        low: i.isActive && Number(i.stock) <= Number(i.minStock),
        recipesCount: usoPorInsumo.get(i.id) ?? 0,
      })),
      units: UNIDADES,
    }
  }

  public async store({ business, request, response, auth }: HttpContext) {
    const { name, unit, minStock, stock, unitCost } = request.only([
      'name',
      'unit',
      'minStock',
      'stock',
      'unitCost',
    ])

    const nombre = String(name ?? '').trim()
    if (!nombre) {
      return response.unprocessableEntity({ status: 'error', message: 'El insumo necesita un nombre' })
    }
    if (!UNIDADES.includes(unit)) {
      return response.unprocessableEntity({ status: 'error', message: 'Unidad no válida' })
    }

    const repetido = await Ingredient.query()
      .where('business_id', business.id)
      .whereILike('name', nombre)
      .first()
    if (repetido) {
      return response.unprocessableEntity({
        status: 'error',
        message: `Ya existe un insumo llamado «${repetido.name}»`,
      })
    }

    const creado = await db.transaction(async (trx) => {
      const insumo = await Ingredient.create(
        {
          businessId: business.id,
          name: nombre,
          unit,
          minStock: Number(minStock ?? 0) || 0,
          stock: 0,
          avgCost: 0,
        },
        { client: trx }
      )

      const inicial = Number(stock ?? 0)
      if (inicial > 0) {
        await IngredientService.aplicar({
          businessId: business.id,
          ingredientId: insumo.id,
          type: 'inicial',
          quantity: inicial,
          unitCost: unitCost === undefined || unitCost === '' ? null : Number(unitCost),
          note: 'Stock inicial',
          userId: auth.user?.id ?? null,
          trx,
        })
      }
      return insumo
    })

    await creado.refresh()
    return response.created({ status: 'success', data: creado })
  }

  public async update({ business, params, request, response }: HttpContext) {
    const insumo = await Ingredient.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    const { name, unit, minStock, isActive } = request.only(['name', 'unit', 'minStock', 'isActive'])

    if (unit !== undefined && unit !== insumo.unit) {
      if (!UNIDADES.includes(unit)) {
        return response.unprocessableEntity({ status: 'error', message: 'Unidad no válida' })
      }
      // Cambiar kg por g con movimientos y recetas hechas corrompería las cantidades.
      const hayHistorial = await IngredientMovement.query().where('ingredient_id', insumo.id).first()
      if (hayHistorial) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'No se puede cambiar la unidad de un insumo que ya tiene movimientos',
        })
      }
      insumo.unit = unit
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        return response.unprocessableEntity({ status: 'error', message: 'El insumo necesita un nombre' })
      }
      insumo.name = String(name).trim()
    }
    if (minStock !== undefined) insumo.minStock = Number(minStock) || 0
    if (isActive !== undefined) insumo.isActive = Boolean(isActive)

    await insumo.save()
    return { status: 'success', data: insumo }
  }

  public async destroy({ business, params, response }: HttpContext) {
    const insumo = await Ingredient.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    const enRecetas = await db.from('recipe_lines').where('ingredient_id', insumo.id).count('* as t').first()
    if (Number(enRecetas?.t ?? 0) > 0) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Está en recetas de platos. Desactívalo en vez de eliminarlo.',
      })
    }

    await insumo.delete()
    return { status: 'success', message: 'Insumo eliminado' }
  }

  /**
   * Compra, ajuste o merma. En el ajuste `quantity` es lo que HAY realmente
   * (conteo físico) y el sistema calcula la diferencia.
   */
  public async addMovement({ business, params, request, response, auth }: HttpContext) {
    const { type, quantity, unitCost, note } = request.only(['type', 'quantity', 'unitCost', 'note'])

    if (!['compra', 'ajuste', 'merma'].includes(type)) {
      return response.unprocessableEntity({ status: 'error', message: 'Tipo de movimiento no válido' })
    }
    const cantidad = Number(quantity)
    if (!Number.isFinite(cantidad) || cantidad < 0 || (type !== 'ajuste' && cantidad === 0)) {
      return response.unprocessableEntity({ status: 'error', message: 'La cantidad no es válida' })
    }

    try {
      const insumo = await db.transaction(async (trx) => {
        const actual = await Ingredient.query({ client: trx })
          .where('business_id', business.id)
          .andWhere('id', params.id)
          .firstOrFail()

        let delta = cantidad
        if (type === 'merma') delta = -cantidad
        if (type === 'ajuste') delta = cantidad - Number(actual.stock)

        if (delta === 0) return actual

        return IngredientService.aplicar({
          businessId: business.id,
          ingredientId: actual.id,
          type,
          quantity: delta,
          unitCost:
            type === 'compra' && unitCost !== undefined && unitCost !== '' ? Number(unitCost) : null,
          note: note ? String(note).slice(0, 255) : null,
          userId: auth.user?.id ?? null,
          trx,
        })
      })

      return { status: 'success', data: insumo }
    } catch (error) {
      if ((error as any)?.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({ status: 'error', message: 'Insumo no encontrado' })
      }
      throw error
    }
  }

  public async movements({ business, params }: HttpContext) {
    const filas = await IngredientMovement.query()
      .where('business_id', business.id)
      .andWhere('ingredient_id', params.id)
      .orderBy('id', 'desc')
      .limit(100)

    return { status: 'success', data: filas }
  }
}
