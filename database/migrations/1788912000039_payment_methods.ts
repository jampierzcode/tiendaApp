import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Métodos de pago de la tienda (Yape, Plin, BCP…): JSON con nombre, tipo,
 * número o cuenta, titular, instrucciones, QR y si está activo. El vendedor IA
 * y el seguimiento del pedido los usan; `payment_instructions` queda como
 * texto libre de respaldo.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.text('payment_methods').nullable()
    })
  }

  async down() {
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('payment_methods')
    })
  }
}
