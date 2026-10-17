import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Compras de verdad: cotización, recepciones parciales, revisión de precios y
 * envíos con seguimiento.
 *
 * - `cotizacion` es un estado de la orden que nunca toca stock ni costos.
 * - El stock entra por recepciones (`purchase_receipts`), cada una con las
 *   cantidades que llegaron físicamente; `received_quantity` es el acumulado
 *   por línea y no puede pasar de lo pedido.
 * - Si el costo sube se crea una `price_review` pendiente: sugiere, no cambia
 *   ningún precio por sí sola.
 */
export default class extends BaseSchema {
  async up() {
    // Estados nuevos: cotizacion y parcial.
    this.schema.raw('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check')
    this.schema.raw(
      `ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
         CHECK (status IN ('cotizacion','borrador','parcial','recibida','cancelada'))`
    )

    this.schema.alterTable('purchase_orders', (table) => {
      table.date('expected_at').nullable()
      table.timestamp('confirmed_at').nullable()
      table.timestamp('closed_at').nullable()
    })

    this.schema.alterTable('purchase_order_items', (table) => {
      table.integer('received_quantity').notNullable().defaultTo(0)
    })
    // Lo que ya estaba recibido antes de esta migración llegó completo.
    this.schema.raw(
      `UPDATE purchase_order_items i SET received_quantity = i.quantity
         FROM purchase_orders o
        WHERE o.id = i.purchase_order_id AND o.status = 'recibida'`
    )

    this.schema.createTable('shipments', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      /** `compra`: viene del proveedor. `pedido`: sale hacia el cliente. */
      table.enum('kind', ['compra', 'pedido']).notNullable()
      table
        .integer('purchase_order_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('purchase_orders')
        .onDelete('SET NULL')
      table
        .integer('order_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('orders')
        .onDelete('SET NULL')
      table.string('carrier', 80).nullable()
      table.string('tracking_code', 80).nullable()
      table.text('tracking_url').nullable()
      table
        .enum('status', ['preparando', 'en_transito', 'entregado', 'incidencia', 'cancelado'])
        .notNullable()
        .defaultTo('preparando')
      table.timestamp('shipped_at').nullable()
      table.date('estimated_at').nullable()
      table.timestamp('delivered_at').nullable()
      table.text('note').nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.index(['business_id', 'kind', 'status'], 'shipments_business_kind_status_index')
    })

    this.schema.createTable('shipment_events', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('shipment_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('shipments')
        .onDelete('CASCADE')
      table.string('status', 20).notNullable()
      table.text('note').nullable()
      table.timestamp('happened_at').defaultTo(this.now())
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })

    this.schema.createTable('purchase_receipts', (table) => {
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
        .integer('shipment_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('shipments')
        .onDelete('SET NULL')
      table.string('code', 20).notNullable()
      table.string('document_number', 40).nullable()
      table.text('note').nullable()
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('received_at').defaultTo(this.now())
    })

    this.schema.createTable('purchase_receipt_items', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('receipt_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('purchase_receipts')
        .onDelete('CASCADE')
      table
        .integer('purchase_order_item_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('purchase_order_items')
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
    })

    this.schema.createTable('price_reviews', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table
        .integer('purchase_receipt_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('purchase_receipts')
        .onDelete('SET NULL')
      table
        .integer('supplier_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('suppliers')
        .onDelete('SET NULL')
      table.decimal('old_cost', 10, 2).notNullable()
      table.decimal('new_cost', 10, 2).notNullable()
      table.decimal('current_price', 10, 2).notNullable()
      table.decimal('suggested_price', 10, 2).notNullable()
      table.decimal('applied_price', 10, 2).nullable()
      table.enum('status', ['pendiente', 'aplicada', 'descartada']).notNullable().defaultTo('pendiente')
      table.timestamp('resolved_at').nullable()
      table
        .integer('resolved_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at').defaultTo(this.now())

      table.index(['business_id', 'status'], 'price_reviews_business_status_index')
    })
  }

  async down() {
    this.schema.dropTableIfExists('price_reviews')
    this.schema.dropTableIfExists('purchase_receipt_items')
    this.schema.dropTableIfExists('purchase_receipts')
    this.schema.dropTableIfExists('shipment_events')
    this.schema.dropTableIfExists('shipments')
    this.schema.alterTable('purchase_order_items', (table) => {
      table.dropColumn('received_quantity')
    })
    this.schema.alterTable('purchase_orders', (table) => {
      table.dropColumn('expected_at')
      table.dropColumn('confirmed_at')
      table.dropColumn('closed_at')
    })
    this.schema.raw('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check')
    this.schema.raw(
      `ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
         CHECK (status IN ('borrador','recibida','cancelada'))`
    )
  }
}
