import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Foto propia por variación.
 *
 * El producto ya tiene su imagen principal, pero en ropa la variación es
 * justo lo que cambia de aspecto: el mismo abrigo en beige y en negro no se
 * puede vender con la misma foto. Cuando la variación no trae imagen, se
 * sigue usando la del producto — por eso es nullable y no obligatoria.
 *
 * `ON DELETE SET NULL`, igual que en products: borrar una foto de la galería
 * no debe llevarse por delante la variación ni su stock.
 */
export default class extends BaseSchema {
  protected tableName = 'product_variations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('business_image_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('business_images')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('business_image_id')
    })
  }
}
