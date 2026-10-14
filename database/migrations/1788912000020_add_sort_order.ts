import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Orden manual (arrastrar y soltar) de categorías, subcategorías y
 * productos. 0 = sin orden propio: desempata el nombre.
 */
export default class extends BaseSchema {
  async up() {
    for (const tabla of ['categories', 'subcategories', 'products']) {
      this.schema.alterTable(tabla, (table) => {
        table.integer('sort_order').notNullable().defaultTo(0)
      })
    }
  }

  async down() {
    for (const tabla of ['categories', 'subcategories', 'products']) {
      this.schema.alterTable(tabla, (table) => {
        table.dropColumn('sort_order')
      })
    }
  }
}
