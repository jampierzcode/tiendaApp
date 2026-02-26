import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'product_variations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('product_id')
        .unsigned()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
        .notNullable()

      table.string('sku').nullable() // Código único opcional
      table.decimal('price', 10, 2).notNullable()
      table.integer('stock').defaultTo(0)
      table.decimal('weight', 10, 2).nullable()
      table.decimal('price_modifier', 10, 2).defaultTo(0)

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
