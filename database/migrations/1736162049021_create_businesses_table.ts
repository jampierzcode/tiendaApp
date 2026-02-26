import { BaseSchema } from '@adonisjs/lucid/schema'

export default class Businesses extends BaseSchema {
  protected tableName = 'businesses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('uuid', 255).notNullable().unique()
      table.string('name', 255).notNullable()
      table.text('description').nullable()
      table.string('logo_url').nullable()
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE') // si el user se borra, se borra el business
      table.enum('status', ['activo', 'inactivo']).defaultTo('activo')
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
