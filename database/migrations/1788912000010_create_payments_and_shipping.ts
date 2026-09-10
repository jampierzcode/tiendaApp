import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Pagos y envíos, los dos módulos que faltaban de la proforma.
 *
 * El pago deja de ser un número suelto en el pedido y pasa a ser un historial:
 * la proforma pide pagos parciales, y con un solo campo no hay forma de saber
 * si los S/ 150 llegaron de una vez o en tres Yapes distintos.
 *
 * `orders.paid_total` se queda como total cacheado que mantiene el servicio,
 * igual que `products.stock` con el kardex.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('payments', (table) => {
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

      table
        .enum('method', ['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta', 'otro'])
        .notNullable()

      table.decimal('amount', 10, 2).notNullable()

      /** Número de operación del Yape, Plin o la transferencia. */
      table.string('reference', 60).nullable()

      /** Foto del comprobante, de la galería del negocio. */
      table
        .integer('receipt_image_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('business_images')
        .onDelete('SET NULL')

      table.string('note', 255).nullable()
      table.timestamp('paid_at').notNullable().defaultTo(this.now())

      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').defaultTo(this.now())

      table.index(['business_id', 'paid_at'], 'payments_business_date_index')
      table.index('order_id', 'payments_order_index')
    })

    this.schema.alterTable('orders', (table) => {
      /** Courier: Olva, Shalom, motorizado propio… texto libre a propósito. */
      table.string('courier', 80).nullable()
      table.string('tracking_code', 80).nullable()
      table.string('tracking_url', 255).nullable()
      table.timestamp('shipped_at').nullable()
      table.timestamp('delivered_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => {
      table.dropColumn('courier')
      table.dropColumn('tracking_code')
      table.dropColumn('tracking_url')
      table.dropColumn('shipped_at')
      table.dropColumn('delivered_at')
    })
    this.schema.dropTable('payments')
  }
}
