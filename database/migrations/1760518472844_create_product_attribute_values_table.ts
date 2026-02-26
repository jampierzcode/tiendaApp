import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'product_attribute_values'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('attribute_id')
        .unsigned()
        .references('id')
        .inTable('product_attributes')
        .onDelete('CASCADE')
        .notNullable()
      table.string('value').notNullable() // Ej: "Rojo", "Azul", "XL", "Nike"
      table.string('hex_color', 7).nullable() // Si es color: "#FF0000"
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
