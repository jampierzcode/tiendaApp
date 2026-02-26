import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'product_attributes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
        .notNullable()
      table.string('name').notNullable() // Ej: "Color", "Talla", "Marca"
      table.string('type').defaultTo('text') // Ej: "text", "color", "number", "select"
      table.boolean('is_required').defaultTo(false)
      table.boolean('is_filterable').defaultTo(true)
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
