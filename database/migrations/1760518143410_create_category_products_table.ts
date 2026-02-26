import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'category_product'

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
      table
        .integer('category_id')
        .unsigned()
        .references('id')
        .inTable('categories')
        .onDelete('CASCADE')
        .notNullable()
      table
        .integer('subcategory_id')
        .unsigned()
        .references('id')
        .inTable('subcategories')
        .onDelete('SET NULL')
        .nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['product_id', 'category_id', 'subcategory_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
