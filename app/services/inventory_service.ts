import ProductVariation from '#models/product_variation'
import StockMovement, { type StockMovementType } from '#models/stock_movement'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export class InsufficientStockError extends Error {
  constructor(
    public available: number,
    public requested: number
  ) {
    super(`Stock insuficiente: quedan ${available} y se pidieron ${requested}`)
  }
}

interface MovementInput {
  businessId: number
  variationId: number
  type: StockMovementType
  /** Con signo: positivo entra, negativo sale. */
  quantity: number
  unitCost?: number | null
  referenceType?: string | null
  referenceId?: number | null
  note?: string | null
  userId?: number | null
  /** Para encadenar varios movimientos en una misma transacción. */
  trx?: TransactionClientContract
}

/**
 * Único punto por el que se mueve el inventario.
 *
 * Toda entrada y salida pasa por aquí, dentro de una transacción y con la
 * fila de la variación bloqueada (`FOR UPDATE`). Es lo que evita que la venta
 * en mostrador y un pedido de la tienda online que llegan a la vez lean el
 * mismo saldo y lo dejen mal: la segunda espera a que la primera termine.
 *
 * Nadie más debe escribir `product_variations.stock` ni `products.stock`.
 */
export default class InventoryService {
  /**
   * Aplica un movimiento y devuelve la variación con su saldo nuevo.
   */
  static async applyMovement(input: MovementInput) {
    const run = async (trx: TransactionClientContract) => {
      const variation = await ProductVariation.query({ client: trx })
        .where('id', input.variationId)
        .andWhere('business_id', input.businessId)
        .forUpdate()
        .firstOrFail()

      const balanceAfter = variation.stock + input.quantity

      // Las salidas no pueden dejar el inventario en negativo. Los ajustes y
      // el saldo inicial sí pueden fijar cualquier valor, porque son
      // correcciones explícitas del operador.
      const isCorrection = input.type === 'ajuste' || input.type === 'inicial'
      if (balanceAfter < 0 && !isCorrection) {
        throw new InsufficientStockError(variation.stock, Math.abs(input.quantity))
      }

      variation.stock = balanceAfter
      variation.useTransaction(trx)
      await variation.save()

      const movement = await StockMovement.create(
        {
          businessId: input.businessId,
          productVariationId: variation.id,
          type: input.type,
          quantity: input.quantity,
          balanceAfter,
          unitCost: input.unitCost ?? null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          note: input.note ?? null,
          userId: input.userId ?? null,
        },
        { client: trx }
      )

      await this.refreshProductStock(variation.productId, trx)

      return { variation, movement }
    }

    // Si nos pasan una transacción nos sumamos a ella; si no, abrimos una.
    return input.trx ? run(input.trx) : db.transaction((trx) => run(trx))
  }

  /**
   * Fija el stock a un valor absoluto registrando la diferencia como ajuste.
   * Es lo que usa el panel cuando alguien corrige el inventario a mano.
   */
  static async setStock(
    input: Omit<MovementInput, 'quantity' | 'type'> & { newStock: number }
  ) {
    const variation = await ProductVariation.query()
      .where('id', input.variationId)
      .andWhere('business_id', input.businessId)
      .firstOrFail()

    const delta = input.newStock - variation.stock

    if (delta === 0) {
      return { variation, movement: null }
    }

    return this.applyMovement({
      ...input,
      type: 'ajuste',
      quantity: delta,
      note: input.note ?? `Ajuste manual de ${variation.stock} a ${input.newStock}`,
    })
  }

  /**
   * Recalcula el total cacheado del producto a partir de sus variaciones.
   */
  static async refreshProductStock(productId: number, trx?: TransactionClientContract) {
    const client = trx ?? db.connection()

    await client.rawQuery(
      `UPDATE products
          SET stock = COALESCE(
            (SELECT SUM(v.stock) FROM product_variations v WHERE v.product_id = products.id), 0
          )
        WHERE products.id = ?`,
      [productId]
    )
  }

  /**
   * Variaciones en o por debajo del mínimo definido en el producto.
   * Alimenta las alertas de inventario del dashboard.
   */
  static async lowStock(businessId: number) {
    return ProductVariation.query()
      .where('product_variations.business_id', businessId)
      .join('products', 'products.id', 'product_variations.product_id')
      .whereRaw('product_variations.stock <= products.low_stock_threshold')
      .where('products.status', 'activo')
      .preload('product')
      .preload('attributes', (q) => q.preload('value'))
      .orderBy('product_variations.stock', 'asc')
  }
}
