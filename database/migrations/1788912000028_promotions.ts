import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Promociones: la tabla `discounts` (un % por producto con fechas) pasa a ser
 * un motor de promociones general.
 *
 *  - tipo: porcentaje, monto fijo menos, o «lleva N paga M» (2x1, 3x2…)
 *  - alcance: toda la tienda, una categoría o un producto
 *  - con código (cupón) o automática
 *  - vigencia opcional (sin fechas = siempre)
 *
 * Lo que ya existía se conserva como promoción de porcentaje por producto.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('discounts', (table) => {
      table.string('name', 120).notNullable().defaultTo('Descuento')
      table.enum('kind', ['percent', 'fixed', 'bundle']).notNullable().defaultTo('percent')
      /** Porcentaje o monto fijo; en `bundle` no se usa. */
      table.decimal('value', 10, 2).notNullable().defaultTo(0)
      table.integer('buy_qty').nullable()
      table.integer('pay_qty').nullable()
      table.enum('scope', ['all', 'category', 'product']).notNullable().defaultTo('product')
      table
        .integer('category_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('categories')
        .onDelete('CASCADE')
      table.string('code', 40).nullable()
      table.boolean('is_active').notNullable().defaultTo(true)
    })

    this.schema.raw('ALTER TABLE discounts ALTER COLUMN start_date DROP NOT NULL')
    this.schema.raw('ALTER TABLE discounts ALTER COLUMN end_date DROP NOT NULL')
    this.schema.raw('ALTER TABLE discounts ALTER COLUMN percentage DROP NOT NULL')
    this.schema.raw('UPDATE discounts SET value = percentage WHERE percentage IS NOT NULL')

    // Un cupón es único por negocio (sin importar mayúsculas).
    this.schema.raw(
      `CREATE UNIQUE INDEX discounts_business_code_unique ON discounts (business_id, lower(code)) WHERE code IS NOT NULL`
    )

    this.schema.alterTable('orders', (table) => {
      table.string('coupon_code', 40).nullable()
    })
    this.schema.alterTable('order_items', (table) => {
      table.string('promotion_name', 120).nullable()
    })
  }

  async down() {
    this.schema.alterTable('order_items', (table) => {
      table.dropColumn('promotion_name')
    })
    this.schema.alterTable('orders', (table) => {
      table.dropColumn('coupon_code')
    })
    this.schema.raw('DROP INDEX IF EXISTS discounts_business_code_unique')
    this.schema.alterTable('discounts', (table) => {
      table.dropColumn('name')
      table.dropColumn('kind')
      table.dropColumn('value')
      table.dropColumn('buy_qty')
      table.dropColumn('pay_qty')
      table.dropColumn('scope')
      table.dropColumn('category_id')
      table.dropColumn('code')
      table.dropColumn('is_active')
    })
  }
}
