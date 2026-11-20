import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Servicio de cada cuenta o pedido: comedor (mesa), para llevar o delivery.
 * Son tres fijos a propósito: no hay servicios personalizados.
 *
 * Los pedidos que ya existían se clasifican por cómo se entregaban.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('orders', (table) => {
      table.string('service', 12).notNullable().defaultTo('para_llevar')
    })
    this.defer(async (db) => {
      await db.rawQuery(`UPDATE orders SET service = 'comedor' WHERE channel = 'salon' OR delivery_method = 'mesa'`)
      await db.rawQuery(`UPDATE orders SET service = 'delivery' WHERE delivery_method = 'envio' AND channel <> 'salon'`)
    })
    this.schema.raw(
      `ALTER TABLE orders ADD CONSTRAINT orders_service_check CHECK (service IN ('comedor','para_llevar','delivery'))`
    )
  }

  async down() {
    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_service_check')
    this.schema.alterTable('orders', (table) => table.dropColumn('service'))
  }
}
