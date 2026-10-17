import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Cuentas de cliente: un usuario (rol `cliente`) puede estar ligado a la ficha
 * de cliente de varias tiendas. Cada tienda sigue guardando su propio contacto
 * (`customers`); la cuenta solo los une para que la persona vea todos sus
 * pedidos. `orders.claim_token` es un código de un solo uso que recibe quien
 * hace el pedido: demuestra que el pedido es suyo al crear la cuenta.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('customers', (table) => {
      table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.index(['user_id'])
    })
    this.schema.alterTable('orders', (table) => {
      table.string('claim_token', 64).nullable()
    })
    this.defer(async (db) => {
      const existe = await db.from('roles').where('name', 'cliente').first()
      if (!existe) {
        await db.table('roles').insert({
          name: 'cliente',
          created_at: new Date(),
          updated_at: new Date(),
        })
      }
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => table.dropColumn('claim_token'))
    this.schema.alterTable('customers', (table) => table.dropColumn('user_id'))
  }
}
