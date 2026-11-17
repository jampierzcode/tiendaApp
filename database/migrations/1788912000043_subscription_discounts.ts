import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Descuento por pago de plan: subtotal (precio × cantidad), el descuento que
 * se aplicó (porcentaje o monto) y el total que queda en `total`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('subscriptions', (table) => {
      table.decimal('subtotal', 10, 2).notNullable().defaultTo(0)
      /** percent | amount | null (sin descuento) */
      table.string('discount_type', 10).nullable()
      table.decimal('discount_value', 10, 2).nullable()
      table.decimal('discount_amount', 10, 2).notNullable().defaultTo(0)
    })
    // Lo ya registrado no tenía descuento: subtotal = total.
    this.defer(async (db) => {
      await db.rawQuery('UPDATE subscriptions SET subtotal = total')
    })
  }

  async down() {
    this.schema.alterTable('subscriptions', (table) => {
      table.dropColumn('subtotal')
      table.dropColumn('discount_type')
      table.dropColumn('discount_value')
      table.dropColumn('discount_amount')
    })
  }
}
