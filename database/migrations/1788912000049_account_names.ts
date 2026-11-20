import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Número de cuenta del PDV, correlativo del día por servicio:
 * M001 (comedor), L001 (para llevar), D001 (delivery). Es lo que se dice en
 * voz alta en el local; el folio fiscal se asigna aparte al imprimir o cobrar.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('orders', (table) => {
      table.string('account_name', 20).nullable()
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => table.dropColumn('account_name'))
  }
}
