import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Configuración del vendedor IA (estilo yavendió!) y stock ilimitado.
 *
 * - `ai_agent_config`: JSON con personalidad, saludo, preguntas frecuentes,
 *   conversación de ejemplo y situaciones para derivar a una persona.
 * - `shipping_zones`: JSON con las zonas de envío; cada una con sus regiones
 *   (distritos, provincias…) y sus tipos de entrega (costo, plazos, pago,
 *   datos que el vendedor debe pedir).
 * - `products.unlimited_stock`: se vende sin mirar el inventario (a pedido,
 *   servicios, productos digitales…).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.text('ai_agent_config').nullable()
      table.text('shipping_zones').nullable()
    })
    this.schema.alterTable('products', (table) => {
      table.boolean('unlimited_stock').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('products', (table) => {
      table.dropColumn('unlimited_stock')
    })
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('ai_agent_config')
      table.dropColumn('shipping_zones')
    })
  }
}
