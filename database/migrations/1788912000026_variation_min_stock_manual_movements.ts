import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * - Mínimo de stock por variación (si es null se usa el del producto).
 * - Dos tipos de movimiento manual para quien no usa Compras: entrada y salida,
 *   además del ajuste a un valor.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('product_variations', (table) => {
      table.integer('low_stock_threshold').nullable()
    })

    this.schema.raw('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check')
    this.schema.raw(
      `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
         CHECK (type IN ('compra','venta','devolucion','ajuste','inicial','merma','entrada_manual','salida_manual'))`
    )
  }

  async down() {
    this.schema.alterTable('product_variations', (table) => {
      table.dropColumn('low_stock_threshold')
    })
    this.schema.raw('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check')
    this.schema.raw(
      `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
         CHECK (type IN ('compra','venta','devolucion','ajuste','inicial','merma'))`
    )
  }
}
