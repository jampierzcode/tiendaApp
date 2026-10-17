import ProductVariation from '#models/product_variation'
import StockMovement, { type StockMovementType } from '#models/stock_movement'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/** Misma regla que `VariationService.SQL_DEFAULT_RETIRADA` (no se importa: sería circular). */
const VARIATION_RETIRADA = `(product_variations.is_default = true AND EXISTS (
  SELECT 1 FROM product_variations s
    JOIN product_variation_attributes a ON a.variation_id = s.id
   WHERE s.product_id = product_variations.product_id))`

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
   * Stock por llegar: lo pedido y todavía no recibido en órdenes vigentes.
   * Las cotizaciones y las órdenes canceladas o cerradas no cuentan.
   */
  static readonly SQL_PENDIENTE = `COALESCE((
    SELECT SUM(i.quantity - i.received_quantity)
      FROM purchase_order_items i
      JOIN purchase_orders o ON o.id = i.purchase_order_id
     WHERE i.product_variation_id = product_variations.id
       AND o.status IN ('borrador', 'parcial')), 0)`

  /**
   * Variaciones cuyo stock proyectado (lo que hay + lo que viene en camino)
   * está en o por debajo del mínimo del producto. Si una compra pendiente ya
   * cubre el faltante no se alerta; si solo lo cubre en parte, sí, y se ve
   * cuánto viene en `pendiente`.
   */
  static async lowStock(businessId: number) {
    const filas = await ProductVariation.query()
      .where('product_variations.business_id', businessId)
      .join('products', 'products.id', 'product_variations.product_id')
      // Sin esto el join trae también las columnas de `products` y su `id` y
      // `stock` pisan los de la variación (se veía el stock total del producto).
      .select('product_variations.*')
      .select(db.raw(`${this.SQL_PENDIENTE} AS pendiente`))
      .whereRaw(
        `product_variations.stock + ${this.SQL_PENDIENTE} <=
           COALESCE(product_variations.low_stock_threshold, products.low_stock_threshold)`
      )
      .where('products.status', 'activo')
      .whereRaw(`NOT ${VARIATION_RETIRADA}`)
      .preload('product')
      .preload('attributes', (q) => q.preload('value'))
      .orderBy('product_variations.stock', 'asc')

    for (const f of filas) f.$extras.pendiente = Number(f.$extras.pendiente ?? 0)
    return filas
  }
}
