import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * PDV de salón (restaurante): personal con PIN, áreas de producción,
 * impresoras, mesas, cuentas abiertas por mesa con rondas de comanda y una
 * cola de impresión que vacía la "central" del local (un celular Android con
 * impresoras Bluetooth).
 *
 * La cuenta de una mesa es un `order` con channel = 'salon' y status
 * 'abierta' mientras se consume; al cobrarla pasa a 'entregado'.
 */
export default class extends BaseSchema {
  async up() {
    // Rol global del personal (meseras). El acceso real lo da business_staff.
    this.defer(async (db) => {
      const existe = await db.from('roles').where('name', 'personal').first()
      if (!existe) {
        await db.table('roles').insert({ name: 'personal', created_at: new Date(), updated_at: new Date() })
      }
    })

    this.schema.createTable('business_staff', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('name', 80).notNullable()
      /** mesero: solo comanda · cajero: además cobra y anula. */
      table.string('role', 20).notNullable().defaultTo('mesero')
      table.string('pin_hash', 255).notNullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.integer('failed_attempts').notNullable().defaultTo(0)
      table.timestamp('locked_until', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.unique(['user_id'])
      table.index(['business_id'])
    })

    this.schema.createTable('printers', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('name', 60).notNullable()
      /** Ancho del papel en mm: 58 u 80. */
      table.integer('paper_width').notNullable().defaultTo(58)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id'])
    })

    this.schema.createTable('production_areas', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('name', 60).notNullable()
      table.integer('printer_id').unsigned().nullable().references('id').inTable('printers').onDelete('SET NULL')
      table.integer('sort_order').notNullable().defaultTo(0)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id'])
    })

    this.schema.alterTable('products', (table) => {
      table.integer('production_area_id').unsigned().nullable().references('id').inTable('production_areas').onDelete('SET NULL')
    })
    this.schema.alterTable('categories', (table) => {
      table.integer('production_area_id').unsigned().nullable().references('id').inTable('production_areas').onDelete('SET NULL')
    })

    this.schema.createTable('dining_tables', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('name', 40).notNullable()
      /** "Salón", "Terraza"… para agrupar en pantalla. */
      table.string('zone', 40).nullable()
      table.integer('seats').nullable()
      table.integer('sort_order').notNullable().defaultTo(0)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id'])
    })

    this.schema.alterTable('orders', (table) => {
      table.integer('dining_table_id').unsigned().nullable().references('id').inTable('dining_tables').onDelete('SET NULL')
      table.integer('guests').nullable()
      /** Quién abrió la cuenta (dueño o mesera). */
      table.integer('opened_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('closed_at', { useTz: true }).nullable()
      table.index(['business_id', 'channel', 'status'], 'orders_business_channel_status_index')
    })

    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check')
    this.schema.raw(
      `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('abierta','pendiente','confirmado','pagado','preparando','listo','enviado','entregado','cancelado','devuelto'))`
    )
    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check')
    this.schema.raw(
      `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN ('whatsapp','mostrador','online','salon'))`
    )
    // Una mesa no puede tener dos cuentas abiertas a la vez.
    this.schema.raw(
      `CREATE UNIQUE INDEX orders_one_open_per_table ON orders (dining_table_id) WHERE status = 'abierta' AND dining_table_id IS NOT NULL`
    )

    /** Cada "Enviar comanda" es una ronda. client_request_id evita duplicarla si la mesera reintenta sin señal. */
    this.schema.createTable('order_rounds', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.integer('order_id').unsigned().notNullable().references('id').inTable('orders').onDelete('CASCADE')
      table.integer('number').notNullable()
      table.string('client_request_id', 64).notNullable()
      table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('user_name', 80).nullable()
      table.timestamp('created_at', { useTz: true })
      table.unique(['business_id', 'client_request_id'])
      table.index(['order_id'])
    })

    this.schema.alterTable('order_items', (table) => {
      table.integer('order_round_id').unsigned().nullable().references('id').inTable('order_rounds').onDelete('SET NULL')
      /** Copia del área al comandar: si después mueven el plato, la comanda vieja no cambia. */
      table.integer('production_area_id').unsigned().nullable().references('id').inTable('production_areas').onDelete('SET NULL')
      table.string('production_area_name', 60).nullable()
      table.timestamp('voided_at', { useTz: true }).nullable()
      table.string('void_reason', 160).nullable()
      table.integer('voided_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
    })

    this.schema.createTable('print_jobs', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      /** Null = la impresora de caja (la que la central marque como tal). */
      table.integer('printer_id').unsigned().nullable().references('id').inTable('printers').onDelete('SET NULL')
      table.integer('order_id').unsigned().nullable().references('id').inTable('orders').onDelete('CASCADE')
      /** comanda | anulacion | precuenta | nota_venta | prueba */
      table.string('kind', 20).notNullable()
      table.text('payload').notNullable()
      /** pendiente | impreso | error */
      table.string('status', 12).notNullable().defaultTo('pendiente')
      table.integer('attempts').notNullable().defaultTo(0)
      table.string('error', 255).nullable()
      table.timestamp('printed_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true })
      table.index(['business_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable('print_jobs')
    this.schema.alterTable('order_items', (table) => {
      table.dropColumn('order_round_id')
      table.dropColumn('production_area_id')
      table.dropColumn('production_area_name')
      table.dropColumn('voided_at')
      table.dropColumn('void_reason')
      table.dropColumn('voided_by_user_id')
    })
    this.schema.dropTable('order_rounds')
    this.schema.raw('DROP INDEX IF EXISTS orders_one_open_per_table')
    this.schema.raw(`DELETE FROM orders WHERE channel = 'salon'`)
    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check')
    this.schema.raw(`ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN ('whatsapp','mostrador','online'))`)
    this.schema.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check')
    this.schema.raw(
      `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pendiente','confirmado','pagado','preparando','listo','enviado','entregado','cancelado','devuelto'))`
    )
    this.schema.alterTable('orders', (table) => {
      table.dropIndex(['business_id', 'channel', 'status'], 'orders_business_channel_status_index')
      table.dropColumn('dining_table_id')
      table.dropColumn('guests')
      table.dropColumn('opened_by_user_id')
      table.dropColumn('closed_at')
    })
    this.schema.dropTable('dining_tables')
    this.schema.alterTable('categories', (table) => table.dropColumn('production_area_id'))
    this.schema.alterTable('products', (table) => table.dropColumn('production_area_id'))
    this.schema.dropTable('production_areas')
    this.schema.dropTable('printers')
    this.schema.dropTable('business_staff')
  }
}
