import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Etiquetas de producto ("nuevo", "oferta", "verano"). La proforma las pide
 * junto a las categorías, y en la tienda pública son lo que permite armar
 * vitrinas sin tocar el árbol de categorías.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('tags', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')

      table.string('name', 80).notNullable()
      table.string('slug', 80).notNullable()
      table.string('color', 7).nullable()

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['business_id', 'slug'], { indexName: 'tags_business_slug_unique' })
    })

    this.schema.createTable('product_tag', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table
        .integer('tag_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tags')
        .onDelete('CASCADE')

      table.unique(['product_id', 'tag_id'], { indexName: 'product_tag_unique' })
    })
  }

  async down() {
    this.schema.dropTable('product_tag')
    this.schema.dropTable('tags')
  }
}
