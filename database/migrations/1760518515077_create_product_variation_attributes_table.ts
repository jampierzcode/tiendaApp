import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'product_variation_attributes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('variation_id')
        .unsigned()
        .references('id')
        .inTable('product_variations')
        .onDelete('CASCADE')
        .notNullable()
      table
        .integer('attribute_value_id')
        .unsigned()
        .references('id')
        .inTable('product_attribute_values')
        .onDelete('CASCADE')
        .notNullable()

      table.unique(['variation_id', 'attribute_value_id'], 'variation_attr_unique') // Evita duplicados
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
