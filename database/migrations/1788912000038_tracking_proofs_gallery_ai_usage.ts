import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * - Envíos por agencia: clave de recojo, agencia de destino y el estado
 *   «en_agencia» (llegó y espera que el comprador lo recoja).
 * - `payment_proofs`: comprobantes (Yape, Plin, transferencia) que el
 *   comprador manda por WhatsApp. Quedan «por validar» hasta que el dueño los
 *   valida (se registra el cobro) o los rechaza.
 * - `product_images`: galería de fotos por producto y por variación (la foto
 *   principal sigue en `business_image_id`).
 * - `ai_usage`: tokens que consume cada respuesta del vendedor IA, para ver
 *   el gasto de OpenAI en el superadmin.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('shipments', (table) => {
      table.string('pickup_key', 40).nullable()
      table.string('agency', 300).nullable()
    })
    this.schema.raw('ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check')
    this.schema.raw(
      `ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
         CHECK (status IN ('preparando','en_transito','en_agencia','entregado','incidencia','cancelado'))`
    )

    this.schema.createTable('payment_proofs', (table) => {
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
      table
        .integer('payment_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('payments')
        .onDelete('SET NULL')
      table.string('phone', 30).nullable()
      table.text('image_url').notNullable()
      table.string('image_key', 255).nullable()
      // Lo que leyó la IA (el dueño lo puede corregir al validar).
      table.decimal('amount', 12, 2).nullable()
      table.string('method', 20).nullable()
      table.string('operation_code', 60).nullable()
      table.string('paid_at_text', 60).nullable()
      table.string('payer_name', 120).nullable()
      table.text('ai_note').nullable()
      table.string('status', 20).notNullable().defaultTo('por_validar')
      table.string('reject_reason', 255).nullable()
      table.timestamp('reviewed_at').nullable()
      table.integer('reviewed_by').unsigned().nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
      table.index(['business_id', 'status'])
      table.index(['order_id'])
    })

    this.schema.createTable('product_images', (table) => {
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
        .integer('product_variation_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('product_variations')
        .onDelete('CASCADE')
      table
        .integer('business_image_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('business_images')
        .onDelete('CASCADE')
      table.integer('sort_order').notNullable().defaultTo(0)
      table.timestamp('created_at').defaultTo(this.now())
      table.index(['product_id', 'product_variation_id'])
    })

    this.schema.createTable('ai_usage', (table) => {
      table.bigIncrements('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('businesses')
        .onDelete('SET NULL')
      table.string('model', 60).notNullable()
      table.integer('prompt_tokens').notNullable().defaultTo(0)
      table.integer('cached_tokens').notNullable().defaultTo(0)
      table.integer('completion_tokens').notNullable().defaultTo(0)
      table.decimal('cost_usd', 12, 6).notNullable().defaultTo(0)
      table.timestamp('created_at').defaultTo(this.now())
      table.index(['created_at'])
      table.index(['business_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('ai_usage')
    this.schema.dropTable('product_images')
    this.schema.dropTable('payment_proofs')
    this.schema.raw('ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check')
    this.schema.raw(
      `ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
         CHECK (status IN ('preparando','en_transito','entregado','incidencia','cancelado'))`
    )
    this.schema.alterTable('shipments', (table) => {
      table.dropColumn('pickup_key')
      table.dropColumn('agency')
    })
  }
}
