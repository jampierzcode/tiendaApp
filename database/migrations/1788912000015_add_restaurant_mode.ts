import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Modo restaurante: menú digital con modificadores, pedidos con cocina y
 * avisos por WhatsApp.
 *
 * Nada de esto toca lo que ya existe: `business_type` arranca en 'retail'
 * para todos los negocios actuales, y las tablas nuevas solo se usan cuando
 * un producto tiene grupos de modificadores asignados.
 *
 * Modificador ≠ variación. La variación es un SKU con stock ("talla M, negro").
 * El modificador es una elección sobre el plato ("punto de la carne", "extra
 * queso +S/ 2") que cambia el precio pero no tiene stock propio.
 */
export default class extends BaseSchema {
  async up() {
    // --- Tipo de negocio ---
    this.schema.alterTable('businesses', (table) => {
      table.string('business_type', 20).notNullable().defaultTo('retail')
      // Plantillas por evento, en JSON: { listo: "...", enviado: "..." }
      table.text('notification_templates').nullable()
    })

    // --- Modificadores ---
    this.schema.createTable('modifier_groups', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table.string('name', 120).notNullable() // "Tipo de carne"
      table.string('description', 255).nullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
      table.index('business_id', 'modifier_groups_business_index')
    })

    this.schema.createTable('modifier_options', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('modifier_group_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('modifier_groups')
        .onDelete('CASCADE')
      table.string('name', 120).notNullable() // "Bien cocida"
      table.decimal('price_delta', 10, 2).notNullable().defaultTo(0)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.integer('sort_order').notNullable().defaultTo(0)
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
      table.index('modifier_group_id', 'modifier_options_group_index')
    })

    // Qué grupos se ofrecen en cada plato, y con qué reglas.
    this.schema.createTable('product_modifier_groups', (table) => {
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
        .integer('modifier_group_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('modifier_groups')
        .onDelete('CASCADE')
      // min 1 = obligatorio; max 1 = escoge uno; max N = escoge hasta N.
      table.integer('min_select').notNullable().defaultTo(0)
      table.integer('max_select').notNullable().defaultTo(1)
      table.integer('sort_order').notNullable().defaultTo(0)
      table.unique(['product_id', 'modifier_group_id'], {
        indexName: 'product_modifier_groups_unique',
      })
    })

    // --- Pedidos ---
    this.schema.alterTable('orders', (table) => {
      table.string('table_label', 30).nullable()
      table.timestamp('ready_at').nullable()
    })

    this.schema.alterTable('order_items', (table) => {
      table.string('note', 255).nullable()
    })

    this.schema.createTable('order_item_modifiers', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('order_item_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('order_items')
        .onDelete('CASCADE')
      table
        .integer('modifier_option_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('modifier_options')
        .onDelete('SET NULL')
      // Copia congelada: el pedido sigue siendo legible si editan el grupo.
      table.string('group_name', 120).notNullable()
      table.string('option_name', 120).notNullable()
      table.decimal('price_delta', 10, 2).notNullable().defaultTo(0)
      table.integer('quantity').notNullable().defaultTo(1)
      table.index('order_item_id', 'order_item_modifiers_item_index')
    })

    // Nuevos estados para cocina. En Postgres el enum de knex es un CHECK.
    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check')
    this.schema.raw(
      `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pendiente','confirmado','pagado','preparando','listo','enviado','entregado','cancelado','devuelto'))`
    )

    // --- Bot de WhatsApp ---
    this.schema.createTable('whatsapp_sessions', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      // Lo que el negocio pidió y lo que el bot reporta que está pasando.
      table.string('desired', 20).notNullable().defaultTo('disconnected')
      table.string('status', 20).notNullable().defaultTo('disconnected')
      table.text('qr').nullable()
      table.string('connected_phone', 30).nullable()
      table.timestamp('updated_at').defaultTo(this.now())
    })

    this.schema.createTable('whatsapp_outbox', (table) => {
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
        .nullable()
        .references('id')
        .inTable('orders')
        .onDelete('SET NULL')
      table.string('phone', 20).notNullable()
      table.string('event', 30).notNullable()
      table.text('body').notNullable()
      table.string('status', 15).notNullable().defaultTo('pendiente')
      table.integer('attempts').notNullable().defaultTo(0)
      table.string('error', 255).nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('sent_at').nullable()
      table.index(['status', 'id'], 'whatsapp_outbox_status_index')
    })
  }

  async down() {
    this.schema.dropTable('whatsapp_outbox')
    this.schema.dropTable('whatsapp_sessions')
    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check')
    this.schema.raw(
      `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pendiente','confirmado','pagado','enviado','entregado','cancelado','devuelto'))`
    )
    this.schema.dropTable('order_item_modifiers')
    this.schema.alterTable('order_items', (table) => {
      table.dropColumn('note')
    })
    this.schema.alterTable('orders', (table) => {
      table.dropColumn('table_label')
      table.dropColumn('ready_at')
    })
    this.schema.dropTable('product_modifier_groups')
    this.schema.dropTable('modifier_options')
    this.schema.dropTable('modifier_groups')
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('business_type')
      table.dropColumn('notification_templates')
    })
  }
}
