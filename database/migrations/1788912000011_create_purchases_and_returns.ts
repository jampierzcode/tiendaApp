import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Compras a proveedores y devoluciones: los dos módulos que faltaban.
 *
 * La venta en mostrador no aparece aquí a propósito. Es un `order` con
 * `channel = 'mostrador'` que nace pagado: si fuera una tabla aparte, el
 * inventario, los pagos y los reportes tendrían que sumarse desde dos sitios
 * y tarde o temprano dejarían de cuadrar.
 */
export default class extends BaseSchema {
  async up() {
    // El ticket de mostrador lleva serie y correlativo. Hoy no se declara a
    // SUNAT, pero es el enganche para cuando se integre con un tercero.
    this.schema.alterTable('orders', (table) => {
      table.string('document_series', 8).nullable()
      table.integer('document_number').unsigned().nullable()
      // Una venta de mostrador puede no tener teléfono: el cliente paga y se va.
      table.string('customer_phone', 20).nullable().alter()
    })

    this.schema.createTable('suppliers', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')

      table.string('name', 150).notNullable()
      table.string('ruc', 20).nullable()
      table.string('contact_name', 120).nullable()
      table.string('phone', 20).nullable()
      table.string('email', 150).nullable()
      table.string('address', 255).nullable()
      table.text('notes').nullable()
      table.enum('status', ['activo', 'inactivo']).notNullable().defaultTo('activo')

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.index(['business_id', 'name'], 'suppliers_business_name_index')
    })

    this.schema.createTable('purchase_orders', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('supplier_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('suppliers')
        .onDelete('RESTRICT')

      table.string('code', 20).notNullable()
      /** Número de la factura o guía que entregó el proveedor. */
      table.string('document_number', 40).nullable()

      table
        .enum('status', ['borrador', 'recibida', 'cancelada'])
        .notNullable()
        .defaultTo('borrador')

      table.decimal('total', 10, 2).notNullable().defaultTo(0)
      table.text('note').nullable()

      /** Cuándo entró la mercadería al inventario. */
      table.timestamp('received_at').nullable()
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['business_id', 'code'], { indexName: 'purchase_orders_business_code_unique' })
      table.index(['business_id', 'status'], 'purchase_orders_business_status_index')
    })

    this.schema.createTable('purchase_order_items', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('purchase_order_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('purchase_orders')
        .onDelete('CASCADE')
      table
        .integer('product_variation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('product_variations')
        .onDelete('RESTRICT')

      table.integer('quantity').notNullable()
      table.decimal('unit_cost', 10, 2).notNullable()
      table.decimal('line_total', 10, 2).notNullable()

      table.timestamp('created_at').defaultTo(this.now())

      table.index('purchase_order_id', 'purchase_order_items_order_index')
    })

    this.schema.createTable('returns', (table) => {
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

      table.string('code', 20).notNullable()
      table.string('reason', 255).nullable()
      table.decimal('total', 10, 2).notNullable().defaultTo(0)
      /** Si la mercadería vuelve al inventario o se da por perdida. */
      table.boolean('restocked').notNullable().defaultTo(true)

      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').defaultTo(this.now())

      table.unique(['business_id', 'code'], { indexName: 'returns_business_code_unique' })
      table.index('order_id', 'returns_order_index')
    })

    this.schema.createTable('return_items', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('return_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('returns')
        .onDelete('CASCADE')
      table
        .integer('order_item_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('order_items')
        .onDelete('CASCADE')

      table.integer('quantity').notNullable()
      table.decimal('line_total', 10, 2).notNullable()

      table.timestamp('created_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable('return_items')
    this.schema.dropTable('returns')
    this.schema.dropTable('purchase_order_items')
    this.schema.dropTable('purchase_orders')
    this.schema.dropTable('suppliers')

    this.schema.alterTable('orders', (table) => {
      table.dropColumn('document_series')
      table.dropColumn('document_number')
    })
  }
}
