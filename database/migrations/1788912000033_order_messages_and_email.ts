import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Mensajes dentro de la plataforma, por pedido: el negocio y el cliente se
 * escriben sin depender de WhatsApp (útil si el cliente dejó mal su número).
 * El cliente entra con el código de su pedido o con su cuenta.
 * `orders.customer_email` guarda el correo de contacto de ese pedido.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('order_messages', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('order_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('orders')
        .onDelete('CASCADE')
      /** out = escribe el negocio; in = escribe el cliente. */
      table.enum('direction', ['in', 'out']).notNullable()
      table.text('body').notNullable()
      table.timestamp('read_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.index(['order_id', 'id'])
    })
    this.schema.alterTable('orders', (table) => {
      table.string('customer_email', 160).nullable()
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => table.dropColumn('customer_email'))
    this.schema.dropTable('order_messages')
  }
}
