import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * - El tipo «Talla» deja de existir: pasa a «Texto» (S, M, L son texto).
 * - País del negocio: de él salen el impuesto (IGV/IVA) y el formato del
 *   teléfono de WhatsApp. Los negocios existentes son de Perú.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw("UPDATE product_attributes SET type = 'text' WHERE type = 'size'")

    this.schema.alterTable('businesses', (table) => {
      table.string('country', 2).notNullable().defaultTo('PE')
    })
  }

  async down() {
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('country')
    })
  }
}
