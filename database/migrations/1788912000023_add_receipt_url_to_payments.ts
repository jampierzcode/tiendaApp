import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * El comprobante de un cobro (captura de Yape, foto del voucher) se guarda en
 * el pago mismo, no en la galería del negocio: la galería es para platos,
 * logos y portadas. `receipt_image_id` queda por compatibilidad.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('payments', (table) => {
      table.text('receipt_url').nullable()
      table.string('receipt_key', 255).nullable()
    })
  }

  async down() {
    this.schema.alterTable('payments', (table) => {
      table.dropColumn('receipt_url')
      table.dropColumn('receipt_key')
    })
  }
}
