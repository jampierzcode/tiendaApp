import Ingredient from '#models/ingredient'
import IngredientMovement, { type TipoMovimientoInsumo } from '#models/ingredient_movement'
import ModifierOption from '#models/modifier_option'
import type Order from '#models/order'
import Recipe from '#models/recipe'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

interface Movimiento {
  businessId: number
  ingredientId: number
  type: TipoMovimientoInsumo
  /** Con signo: negativo descuenta. */
  quantity: number
  unitCost?: number | null
  referenceType?: string | null
  referenceId?: number | null
  note?: string | null
  userId?: number | null
  trx: TransactionClientContract
}

const redondear = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d

/**
 * Inventario de insumos.
 *
 * Un único punto escribe el stock (`aplicar`), igual que en el POS: así el
 * saldo y el libro de movimientos no pueden desincronizarse. El stock puede
 * quedar negativo a propósito: una venta nunca se bloquea porque el conteo
 * del insumo esté atrasado; se avisa y se corrige con un ajuste.
 */
export default class IngredientService {
  static async aplicar(m: Movimiento) {
    const insumo = await Ingredient.query({ client: m.trx })
      .where('business_id', m.businessId)
      .andWhere('id', m.ingredientId)
      .forUpdate()
      .firstOrFail()

    const stockAntes = Number(insumo.stock)
    const stockDespues = redondear(stockAntes + m.quantity)

    // Costo promedio ponderado: solo las entradas con costo lo mueven. Las
    // existencias negativas cuentan como 0 para no distorsionar el promedio.
    if (m.quantity > 0 && m.unitCost !== null && m.unitCost !== undefined) {
      const base = Math.max(stockAntes, 0)
      const total = base + m.quantity
      insumo.avgCost =
        total > 0 ? redondear((base * Number(insumo.avgCost) + m.quantity * m.unitCost) / total, 4) : m.unitCost
    }

    insumo.stock = stockDespues
    insumo.useTransaction(m.trx)
    await insumo.save()

    await IngredientMovement.create(
      {
        businessId: m.businessId,
        ingredientId: m.ingredientId,
        type: m.type,
        quantity: m.quantity,
        unitCost: m.unitCost ?? null,
        stockAfter: stockDespues,
        referenceType: m.referenceType ?? null,
        referenceId: m.referenceId ?? null,
        note: m.note ?? null,
        userId: m.userId ?? null,
      },
      { client: m.trx }
    )

    return insumo
  }

  /** Costo de una receta con los costos promedio actuales. */
  static costoDeLineas(
    lineas: { quantity: number; wastePercent: number; ingredient?: { avgCost: number } | null }[]
  ) {
    return redondear(
      lineas.reduce(
        (t, l) =>
          t + Number(l.quantity) * (1 + Number(l.wastePercent) / 100) * Number(l.ingredient?.avgCost ?? 0),
        0
      ),
      2
    )
  }

  /**
   * Descuenta lo que gastó el pedido: la receta de cada plato más los insumos
   * de los extras elegidos. Devuelve los platos que no tienen receta, para
   * que el panel pueda avisar que ese consumo no se está registrando.
   */
  static async consumirPedido(order: Order, trx: TransactionClientContract, userId: number | null) {
    await order.load('items', (q) => q.preload('modifiers'))

    const productIds = [...new Set(order.items.map((i) => i.productId).filter((v): v is number => !!v))]

    const recetas = productIds.length
      ? await Recipe.query({ client: trx })
          .where('business_id', order.businessId)
          .whereIn('product_id', productIds)
          .preload('lines')
      : []
    const recetaPorProducto = new Map(recetas.map((r) => [r.productId, r]))

    const optionIds = order.items.flatMap((i) =>
      i.modifiers.map((m) => m.modifierOptionId).filter((v): v is number => !!v)
    )
    const opciones = optionIds.length
      ? await ModifierOption.query({ client: trx }).whereIn('id', optionIds)
      : []
    const opcionPorId = new Map(opciones.map((o) => [o.id, o]))

    const total = new Map<number, number>()
    const sumar = (id: number, q: number) => total.set(id, (total.get(id) ?? 0) + q)
    const sinReceta: string[] = []

    for (const item of order.items) {
      const receta = item.productId ? recetaPorProducto.get(item.productId) : null

      if (!receta || receta.lines.length === 0) {
        sinReceta.push(item.productName)
      } else {
        for (const l of receta.lines) {
          sumar(l.ingredientId, Number(l.quantity) * (1 + Number(l.wastePercent) / 100) * item.quantity)
        }
      }

      for (const mod of item.modifiers) {
        const opcion = mod.modifierOptionId ? opcionPorId.get(mod.modifierOptionId) : null
        if (opcion?.ingredientId && Number(opcion.ingredientQty) > 0) {
          sumar(opcion.ingredientId, Number(opcion.ingredientQty) * mod.quantity * item.quantity)
        }
      }
    }

    for (const [ingredientId, cantidad] of total) {
      await this.aplicar({
        businessId: order.businessId,
        ingredientId,
        type: 'consumo',
        quantity: -redondear(cantidad),
        referenceType: 'order',
        referenceId: order.id,
        note: `Pedido ${order.code}`,
        userId,
        trx,
      })
    }

    return { sinReceta: [...new Set(sinReceta)] }
  }

  /**
   * Repone lo que el pedido consumió. Lee los movimientos reales del pedido
   * en vez de recalcular desde la receta: si la receta cambió entre la venta
   * y la cancelación, igual se devuelve exactamente lo que se descontó.
   */
  static async reponerPedido(order: Order, trx: TransactionClientContract, userId: number | null) {
    const consumos = await IngredientMovement.query({ client: trx })
      .where('business_id', order.businessId)
      .andWhere('reference_type', 'order')
      .andWhere('reference_id', order.id)
      .andWhere('type', 'consumo')

    for (const c of consumos) {
      await this.aplicar({
        businessId: order.businessId,
        ingredientId: c.ingredientId,
        type: 'devolucion',
        quantity: Math.abs(Number(c.quantity)),
        referenceType: 'order',
        referenceId: order.id,
        note: `Reposición del pedido ${order.code}`,
        userId,
        trx,
      })
    }
  }

  /** Cuántos insumos están por debajo de su mínimo. */
  static async contarBajos(businessId: number) {
    const fila = await db
      .from('ingredients')
      .where('business_id', businessId)
      .andWhere('is_active', true)
      .whereRaw('stock <= min_stock')
      .count('* as total')
      .first()
    return Number(fila?.total ?? 0)
  }
}
