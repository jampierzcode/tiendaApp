import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Política de cobro del negocio: cuándo se exige registrar el pago.
 * 'none' no exige nada (como hasta ahora), 'on_confirm' es pago por
 * adelantado y 'on_delivery' es contra entrega. Las instrucciones (a qué
 * Yape/cuenta pagar) las ve el cliente en la carta y en su seguimiento.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.string('payment_policy', 20).notNullable().defaultTo('none')
      table.text('payment_instructions').nullable()
    })
  }

  async down() {
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('payment_policy')
      table.dropColumn('payment_instructions')
    })
  }
}
