import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'business_images'

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

      table.string('url', 255).notNullable()
      table.string('name', 150).nullable()
      table.string('description', 255).nullable()
      table
        .enum('type', ['producto', 'banner', 'logo', 'galeria'])
        .defaultTo('galeria')
        .notNullable()

      table.enum('status', ['activo', 'inactivo']).defaultTo('activo').notNullable()

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
