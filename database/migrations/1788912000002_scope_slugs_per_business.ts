import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Los slugs eran únicos en toda la base, así que la segunda tienda que
 * quisiera una categoría "polos" chocaba con la primera. En un sistema
 * multitenant el slug solo tiene que ser único dentro de su negocio.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('categories', (table) => {
      table.dropUnique(['slug'], 'categories_slug_unique')
      table.unique(['business_id', 'slug'], { indexName: 'categories_business_slug_unique' })
    })

    this.schema.alterTable('subcategories', (table) => {
      table.dropUnique(['slug'], 'subcategories_slug_unique')
      table.unique(['business_id', 'slug'], { indexName: 'subcategories_business_slug_unique' })
    })
  }

  async down() {
    this.schema.alterTable('categories', (table) => {
      table.dropUnique(['business_id', 'slug'], 'categories_business_slug_unique')
      table.unique(['slug'], { indexName: 'categories_slug_unique' })
    })

    this.schema.alterTable('subcategories', (table) => {
      table.dropUnique(['business_id', 'slug'], 'subcategories_business_slug_unique')
      table.unique(['slug'], { indexName: 'subcategories_slug_unique' })
    })
  }
}
