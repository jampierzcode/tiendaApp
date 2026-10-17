import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Suscripciones de avisos push del navegador (Web Push): una por dispositivo.
 * Sirven para avisar al dueño y a los clientes aunque la pestaña esté en
 * segundo plano o cerrada.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('push_subscriptions', (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('endpoint', 700).notNullable().unique()
      table.string('p256dh', 200).notNullable()
      table.string('auth', 100).notNullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable('push_subscriptions')
  }
}
