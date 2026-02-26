import { BaseSchema } from '@adonisjs/lucid/schema'

export default class UpdateProductsAddBusinessImageId extends BaseSchema {
  protected tableName = 'products'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Eliminamos el campo antiguo que guardaba directamente la URL
      table.dropColumn('image_url')

      // Agregamos la relación referencial hacia la galería del negocio
      table
        .integer('business_image_id')
        .unsigned()
        .references('id')
        .inTable('business_images')
        .onDelete('SET NULL')
        .nullable()
        .after('business_id')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      // Restauramos el campo image_url si se hace rollback
      table.string('image_url').nullable()

      // Eliminamos la referencia
      table.dropColumn('business_image_id')
    })
  }
}
