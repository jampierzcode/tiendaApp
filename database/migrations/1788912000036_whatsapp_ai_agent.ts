import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Asistente de ventas con IA en el WhatsApp del negocio.
 *
 * - `ai_agent_enabled`: si el bot conversa con IA (si no, solo responde
 *   «menú» / «mi pedido» con las reglas de siempre).
 * - `ai_agent_instructions`: lo que el dueño quiere que el asistente sepa o
 *   haga (políticas, preguntas frecuentes, tono, zonas de reparto…).
 * - `whatsapp_agent_pauses`: cuando el dueño contesta a mano (o el asistente
 *   deriva a una persona), el asistente se calla con ese cliente un rato.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.boolean('ai_agent_enabled').notNullable().defaultTo(true)
      table.text('ai_agent_instructions').nullable()
    })

    this.schema.createTable('whatsapp_agent_pauses', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      // Últimos 9 dígitos, igual que `whatsapp_messages.contact`.
      table.string('contact', 30).notNullable()
      table.timestamp('paused_until').notNullable()
      table.string('reason', 255).nullable()
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
      table.unique(['business_id', 'contact'])
    })
  }

  async down() {
    this.schema.dropTable('whatsapp_agent_pauses')
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('ai_agent_enabled')
      table.dropColumn('ai_agent_instructions')
    })
  }
}
