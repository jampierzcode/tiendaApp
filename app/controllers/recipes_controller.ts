import Ingredient from '#models/ingredient'
import Product from '#models/product'
import Recipe from '#models/recipe'
import RecipeLine from '#models/recipe_line'
import IngredientService from '#services/ingredient_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

/**
 * Recetas: cuánto de cada insumo lleva un plato.
 */
export default class RecipesController {
  /** Resumen de todas las recetas: costo y margen por plato, para la lista. */
  public async index({ business }: HttpContext) {
    const recetas = await Recipe.query()
      .where('business_id', business.id)
      .preload('lines', (l) => l.preload('ingredient'))

    return {
      status: 'success',
      data: recetas.map((r) => ({
        productId: r.productId,
        linesCount: r.lines.length,
        cost: IngredientService.costoDeLineas(r.lines as any),
      })),
    }
  }

  public async show({ business, params, response }: HttpContext) {
    const product = await Product.query()
      .where('business_id', business.id)
      .andWhere('id', params.productId)
      .first()
    if (!product) return response.notFound({ status: 'error', message: 'Producto no encontrado' })

    const receta = await Recipe.query()
      .where('business_id', business.id)
      .andWhere('product_id', product.id)
      .preload('lines', (l) => l.preload('ingredient'))
      .first()

    const lines = (receta?.lines ?? []).map((l) => ({
      ingredientId: l.ingredientId,
      name: l.ingredient.name,
      unit: l.ingredient.unit,
      quantity: Number(l.quantity),
      wastePercent: Number(l.wastePercent),
      avgCost: Number(l.ingredient.avgCost),
      stock: Number(l.ingredient.stock),
      lineCost:
        Math.round(
          Number(l.quantity) * (1 + Number(l.wastePercent) / 100) * Number(l.ingredient.avgCost) * 100
        ) / 100,
    }))

    return {
      status: 'success',
      data: {
        productId: product.id,
        price: Number(product.price),
        cost: IngredientService.costoDeLineas((receta?.lines ?? []) as any),
        lines,
      },
    }
  }

  /** Reemplaza la receta completa del plato. */
  public async sync({ business, params, request, response }: HttpContext) {
    const product = await Product.query()
      .where('business_id', business.id)
      .andWhere('id', params.productId)
      .first()
    if (!product) return response.notFound({ status: 'error', message: 'Producto no encontrado' })

    const entrada: any[] = Array.isArray(request.input('lines')) ? request.input('lines') : []

    const vistos = new Set<number>()
    const limpias: { ingredientId: number; quantity: number; wastePercent: number }[] = []
    for (const l of entrada) {
      const ingredientId = Number(l.ingredientId)
      const quantity = Number(l.quantity)
      const wastePercent = Math.min(100, Math.max(0, Number(l.wastePercent ?? 0) || 0))

      if (!ingredientId || !Number.isFinite(quantity) || quantity <= 0) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'Cada línea necesita un insumo y una cantidad mayor a 0',
        })
      }
      if (vistos.has(ingredientId)) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'Un insumo está repetido en la receta',
        })
      }
      vistos.add(ingredientId)
      limpias.push({ ingredientId, quantity, wastePercent })
    }

    const propios = limpias.length
      ? await Ingredient.query()
          .where('business_id', business.id)
          .whereIn('id', limpias.map((l) => l.ingredientId))
      : []
    if (propios.length !== limpias.length) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Alguno de los insumos no pertenece a este negocio',
      })
    }

    await db.transaction(async (trx) => {
      let receta = await Recipe.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('product_id', product.id)
        .first()

      if (!receta) {
        receta = await Recipe.create({ businessId: business.id, productId: product.id }, { client: trx })
      }

      await RecipeLine.query({ client: trx }).where('recipe_id', receta.id).delete()

      for (const l of limpias) {
        await RecipeLine.create({ businessId: business.id, recipeId: receta.id, ...l }, { client: trx })
      }
    })

    return { status: 'success', message: 'Receta guardada' }
  }
}
