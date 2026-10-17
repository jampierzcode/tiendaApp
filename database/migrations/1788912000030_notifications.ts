import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Notificaciones del panel: avisos con leído / no leído. Hoy el tipo es
 * `pedido` (llega un pedido por la tienda) y apunta al pedido para abrirlo
 * directo; la columna `type` deja espacio a otros avisos más adelante.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('notifications', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table.string('type', 30).notNullable().defaultTo('pedido')
      table.string('title', 160).notNullable()
      table.string('body', 300).nullable()
      table
        .integer('order_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('orders')
        .onDelete('CASCADE')
      table.timestamp('read_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.index(['business_id', 'read_at', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('notifications')
  }
}
