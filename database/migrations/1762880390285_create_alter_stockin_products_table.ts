import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'products'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Agregamos la relación referencial hacia la galería del negocio
      table.integer('stock').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      // Agregamos la relación referencial hacia la galería del negocio
      table.dropColumn('stock')
    })
  }
}
