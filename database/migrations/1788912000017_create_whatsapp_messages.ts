import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Conversación con el cliente: todo lo que entra y sale por WhatsApp.
 * `contact` son los últimos 9 dígitos y agrupa los mensajes de una misma
 * persona aunque el número llegue con o sin prefijo de país.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('whatsapp_messages', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table.string('contact', 20).notNullable()
      table.string('phone', 30).notNullable()
      table.string('direction', 3).notNullable() // in | out
      table.text('body').notNullable()
      // true = aviso automático de estado o respuesta del bot; false = lo escribió una persona
      table.boolean('automatic').notNullable().defaultTo(false)
      table.timestamp('read_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.index(['business_id', 'contact', 'id'])
    })
  }

  async down() {
    this.schema.dropTable('whatsapp_messages')
  }
}
