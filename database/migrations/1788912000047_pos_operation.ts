import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Operación completa del PDV:
 *  - Series de folio compartibles entre cajas (folio al "Imprimir cuenta").
 *  - Estado de la cuenta (abierta / impresa / reabierta) aparte del pedido.
 *  - Mesa "por liberar" después de cobrar (si el negocio libera a mano).
 *  - Dispositivos vinculados al negocio y entrada del personal solo con PIN.
 *  - Rol gerente, permisos por rol y autorizaciones con PIN de un superior.
 *  - Declaración de lo que cobró cada mesero dentro de una caja.
 *  - Ajustes del PDV (permisos, inactividad, tickets…) en `businesses.pos_settings`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('folio_series', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('code', 16).notNullable()
      table.string('name', 60).nullable()
      table.integer('next_number').notNullable().defaultTo(1)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.unique(['business_id', 'code'])
    })

    this.schema.alterTable('cash_registers', (table) => {
      table.integer('folio_series_id').unsigned().nullable().references('id').inTable('folio_series').onDelete('SET NULL')
    })

    this.schema.alterTable('orders', (table) => {
      /** abierta | impresa | reabierta (solo mientras status = 'abierta'). */
      table.string('account_status', 12).nullable()
      table.string('folio_series', 16).nullable()
      table.integer('folio_number').nullable()
      table.integer('print_count').notNullable().defaultTo(0)
      table.integer('reopen_count').notNullable().defaultTo(0)
      table.timestamp('printed_at', { useTz: true }).nullable()
      /** Mesa liberada con la cuenta aún abierta (el cliente pasa a pagar a caja). */
      table.timestamp('table_released_at', { useTz: true }).nullable()
      /** Cortesía o descuento de cuenta: quién lo autorizó. */
      table.string('discount_reason', 160).nullable()
    })
    this.schema.raw(
      `CREATE UNIQUE INDEX orders_folio_unique ON orders (business_id, folio_series, folio_number) WHERE folio_number IS NOT NULL`
    )
    this.defer(async (db) => {
      await db.rawQuery(`UPDATE orders SET account_status = 'abierta' WHERE status = 'abierta'`)
    })

    this.schema.alterTable('order_items', (table) => {
      table.boolean('is_courtesy').notNullable().defaultTo(false)
    })

    this.schema.alterTable('dining_tables', (table) => {
      /** Se cobró pero la mesa aún no se libera (limpieza). */
      table.boolean('needs_release').notNullable().defaultTo(false)
    })

    this.schema.alterTable('business_staff', (table) => {
      /** HMAC del PIN: permite entrar solo con PIN y exige que no se repita en el negocio. */
      table.string('pin_lookup', 64).nullable()
      table.unique(['business_id', 'pin_lookup'])
    })

    this.schema.alterTable('businesses', (table) => {
      table.text('pos_settings').nullable()
      /** Código para vincular celulares y tablets al negocio. */
      table.string('pos_pairing_code', 12).nullable()
    })

    this.schema.createTable('pos_devices', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('name', 60).notNullable()
      table.string('token_hash', 64).notNullable().unique()
      /** Caja a la que cobra este equipo (opcional). */
      table.integer('cash_register_id').unsigned().nullable().references('id').inTable('cash_registers').onDelete('SET NULL')
      table.timestamp('last_seen_at', { useTz: true }).nullable()
      table.timestamp('revoked_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id'])
    })

    this.schema.alterTable('auth_access_tokens', (table) => {
      /** Equipo desde el que entró el personal (para saber a qué caja cobra). */
      table.integer('pos_device_id').unsigned().nullable()
    })

    this.schema.createTable('authorization_logs', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('permission', 40).notNullable()
      table.integer('requested_by_user_id').unsigned().nullable()
      table.string('requested_by_name', 80).nullable()
      table.integer('authorized_by_user_id').unsigned().nullable()
      table.string('authorized_by_name', 80).nullable()
      table.string('context', 255).nullable()
      table.timestamp('created_at', { useTz: true })
      table.index(['business_id', 'created_at'])
    })

    /** Lo que cada mesero (no responsable de la caja) entregó de lo que cobró. */
    this.schema.createTable('cash_collector_declarations', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.integer('cash_session_id').unsigned().notNullable().references('id').inTable('cash_sessions').onDelete('CASCADE')
      table.integer('user_id').unsigned().notNullable()
      table.string('user_name', 80).nullable()
      table.text('declared').notNullable()
      table.text('expected').notNullable()
      table.decimal('difference', 12, 2).notNullable().defaultTo(0)
      table.integer('received_by_user_id').unsigned().nullable()
      table.string('received_by_name', 80).nullable()
      table.timestamp('created_at', { useTz: true })
      table.unique(['cash_session_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable('cash_collector_declarations')
    this.schema.dropTable('authorization_logs')
    this.schema.alterTable('auth_access_tokens', (t) => t.dropColumn('pos_device_id'))
    this.schema.dropTable('pos_devices')
    this.schema.alterTable('businesses', (t) => {
      t.dropColumn('pos_settings')
      t.dropColumn('pos_pairing_code')
    })
    this.schema.alterTable('business_staff', (t) => {
      t.dropUnique(['business_id', 'pin_lookup'])
      t.dropColumn('pin_lookup')
    })
    this.schema.alterTable('dining_tables', (t) => t.dropColumn('needs_release'))
    this.schema.alterTable('order_items', (t) => t.dropColumn('is_courtesy'))
    this.schema.raw('DROP INDEX IF EXISTS orders_folio_unique')
    this.schema.alterTable('orders', (t) => {
      for (const c of ['account_status', 'folio_series', 'folio_number', 'print_count', 'reopen_count', 'printed_at', 'table_released_at', 'discount_reason']) {
        t.dropColumn(c)
      }
    })
    this.schema.alterTable('cash_registers', (t) => t.dropColumn('folio_series_id'))
    this.schema.dropTable('folio_series')
  }
}
