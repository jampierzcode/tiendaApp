import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Guarda la clave del objeto en el bucket, además de la URL.
 *
 * La URL sirve para pintar la imagen; la clave es lo que hace falta para
 * borrarla del bucket cuando se elimina del panel. Sin ella, borrar una
 * imagen dejaría el archivo huérfano ocupando espacio para siempre.
 */
export default class extends BaseSchema {
  protected tableName = 'business_images'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('storage_key', 512).nullable()
      table.integer('size_bytes').unsigned().nullable()
      table.string('content_type', 100).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('storage_key')
      table.dropColumn('size_bytes')
      table.dropColumn('content_type')
    })
  }
}
