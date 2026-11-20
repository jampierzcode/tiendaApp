import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Monitor de producción (KDS).
 *
 * Cada plato que sale a un área tiene su propio estado de cocina, aparte del
 * estado de la cuenta: pendiente → preparando → listo → servido. Así la
 * mesera sabe qué ya puede llevar, y el pedido online pasa a "listo" solo
 * cuando todas sus áreas terminaron.
 *
 * Un equipo vinculado puede ser "monitor": muestra los platos de sus áreas
 * sin pedir PIN (es una pantalla fija en cocina o barra).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('order_items', (table) => {
      /** null = no pasa por cocina (pedidos viejos o retail). */
      table.string('kitchen_status', 12).nullable()
      table.timestamp('sent_to_kitchen_at', { useTz: true }).nullable()
      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('ready_at', { useTz: true }).nullable()
      table.timestamp('served_at', { useTz: true }).nullable()
      table.index(['business_id', 'kitchen_status'], 'order_items_kitchen_index')
    })

    this.schema.alterTable('pos_devices', (table) => {
      /** pdv: comandero/caja con PIN · monitor: pantalla de producción. */
      table.string('mode', 10).notNullable().defaultTo('pdv')
      /** JSON con las áreas que muestra el monitor (vacío = todas). */
      table.text('area_ids').nullable()
    })
  }

  async down() {
    this.schema.alterTable('pos_devices', (table) => {
      table.dropColumn('mode')
      table.dropColumn('area_ids')
    })
    this.schema.alterTable('order_items', (table) => {
      table.dropIndex(['business_id', 'kitchen_status'], 'order_items_kitchen_index')
      for (const c of [
        'kitchen_status',
        'sent_to_kitchen_at',
        'started_at',
        'ready_at',
        'served_at',
      ])
        table.dropColumn(c)
    })
  }
}
