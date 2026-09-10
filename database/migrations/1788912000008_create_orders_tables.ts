import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Clientes y pedidos: el módulo que la proforma vende y que no existía en
 * ninguna forma.
 *
 * Los pedidos guardan copia del nombre y el precio del producto en el momento
 * de la compra. Suena redundante, pero si mañana suben el precio del polo, el
 * pedido de ayer tiene que seguir diciendo lo que el cliente pagó realmente.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('customers', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')

      table.string('name', 150).notNullable()
      table.string('phone', 20).notNullable()
      table.string('email', 150).nullable()
      table.string('document', 20).nullable()
      table.string('address', 255).nullable()
      table.string('city', 100).nullable()
      table.text('notes').nullable()

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      // El teléfono identifica al cliente dentro de su tienda: es lo que se
      // tiene siempre cuando el pedido llega por WhatsApp.
      table.unique(['business_id', 'phone'], { indexName: 'customers_business_phone_unique' })
    })

    this.schema.createTable('orders', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')

      // Código corto que el cliente puede citar por WhatsApp.
      table.string('code', 20).notNullable()

      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('customers')
        .onDelete('SET NULL')

      table.enum('channel', ['whatsapp', 'mostrador', 'online']).notNullable().defaultTo('whatsapp')

      table
        .enum('status', [
          'pendiente',
          'confirmado',
          'pagado',
          'enviado',
          'entregado',
          'cancelado',
          'devuelto',
        ])
        .notNullable()
        .defaultTo('pendiente')

      // Copia de los datos del cliente al momento del pedido.
      table.string('customer_name', 150).notNullable()
      table.string('customer_phone', 20).notNullable()
      table.string('delivery_method', 30).notNullable().defaultTo('envio')
      table.string('delivery_address', 255).nullable()
      table.string('delivery_city', 100).nullable()
      table.text('note').nullable()

      table.decimal('subtotal', 10, 2).notNullable().defaultTo(0)
      table.decimal('discount_total', 10, 2).notNullable().defaultTo(0)
      table.decimal('shipping_cost', 10, 2).notNullable().defaultTo(0)
      table.decimal('total', 10, 2).notNullable().defaultTo(0)
      table.decimal('paid_total', 10, 2).notNullable().defaultTo(0)
      table.string('currency', 3).notNullable().defaultTo('PEN')

      // Cuándo se abrió el chat de WhatsApp con este pedido.
      table.timestamp('whatsapp_sent_at').nullable()
      // Cuándo se descontó el stock, para no descontarlo dos veces.
      table.timestamp('stock_committed_at').nullable()

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['business_id', 'code'], { indexName: 'orders_business_code_unique' })
      table.index(['business_id', 'status'], 'orders_business_status_index')
      table.index(['business_id', 'created_at'], 'orders_business_date_index')
    })

    this.schema.createTable('order_items', (table) => {
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

      // Si el producto se borra, la línea del pedido sobrevive con su copia.
      table
        .integer('product_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('products')
        .onDelete('SET NULL')
      table
        .integer('product_variation_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('product_variations')
        .onDelete('SET NULL')

      table.string('product_name', 255).notNullable()
      table.string('sku', 100).nullable()
      /** "Talla M · Color Negro", congelado al momento de la compra. */
      table.string('variation_label', 255).nullable()

      table.decimal('unit_price', 10, 2).notNullable()
      table.decimal('unit_cost', 10, 2).nullable()
      table.decimal('discount_percentage', 5, 2).notNullable().defaultTo(0)
      table.integer('quantity').notNullable()
      table.decimal('line_total', 10, 2).notNullable()

      table.timestamp('created_at').defaultTo(this.now())

      table.index('order_id', 'order_items_order_index')
    })
  }

  async down() {
    this.schema.dropTable('order_items')
    this.schema.dropTable('orders')
    this.schema.dropTable('customers')
  }
}
