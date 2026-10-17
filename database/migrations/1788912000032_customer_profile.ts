import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Perfil del cliente: WhatsApp y una dirección de entrega guardada (con
 * coordenadas opcionales de «mi ubicación actual») para no volver a escribirlas
 * en cada pedido. Vive en `users` porque la cuenta es global.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.string('phone', 20).nullable()
      table.string('delivery_address', 255).nullable()
      table.string('delivery_city', 80).nullable()
      table.decimal('latitude', 10, 7).nullable()
      table.decimal('longitude', 10, 7).nullable()
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('phone')
      table.dropColumn('delivery_address')
      table.dropColumn('delivery_city')
      table.dropColumn('latitude')
      table.dropColumn('longitude')
    })
  }
}
