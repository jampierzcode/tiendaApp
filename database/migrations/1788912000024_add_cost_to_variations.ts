import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Costo de compra por variación. Es lo que se pagó la última vez por esa talla
 * o color; no tiene nada que ver con el precio de venta (`price`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('product_variations', (table) => {
      table.decimal('cost', 12, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable('product_variations', (table) => {
      table.dropColumn('cost')
    })
  }
}
