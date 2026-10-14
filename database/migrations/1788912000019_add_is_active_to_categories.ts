import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Categorías activables: una categoría inactiva desaparece de la tienda
 * pública junto con los productos que solo viven en ella. El estado propio
 * de cada producto no se toca, así que reactivarla lo devuelve todo igual.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('categories', (table) => {
      table.boolean('is_active').notNullable().defaultTo(true)
    })
  }

  async down() {
    this.schema.alterTable('categories', (table) => {
      table.dropColumn('is_active')
    })
  }
}
