import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Datos comerciales de la suscripción, que opera el superadmin: plan
 * contratado, y hasta cuándo está pagado. Los negocios existentes quedan sin vencimiento.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.string('plan', 60).nullable()
      table.timestamp('paid_until').nullable()
    })
  }

  async down() {
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('plan')
      table.dropColumn('paid_until')
    })
  }
}
