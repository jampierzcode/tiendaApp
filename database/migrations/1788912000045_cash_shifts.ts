import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Turnos y caja.
 *
 *   turno (shift)        — la jornada del negocio. Se cierra con el corte global.
 *     └ sesión de caja   — una caja abierta por una persona, con fondo inicial.
 *         ├ pagos        — todo cobro que entra mientras está abierta.
 *         └ movimientos  — ingresos y retiros de efectivo (gastos, sencillo…).
 *
 * Corte X: foto de la sesión sin cerrarla. Corte Z: se declara lo contado por
 * método, se calcula la diferencia y la sesión se cierra. Corte global: con
 * todas las sesiones cerradas, se cierra el turno y queda el resumen del día.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('cash_registers', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.string('name', 60).notNullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id'])
    })

    this.schema.createTable('shifts', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      /** Correlativo por negocio: Turno #12. */
      table.integer('number').notNullable()
      /** abierto | cerrado */
      table.string('status', 10).notNullable().defaultTo('abierto')
      table.integer('opened_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('opened_by_name', 80).nullable()
      table.timestamp('opened_at', { useTz: true }).notNullable()
      table.integer('closed_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('closed_by_name', 80).nullable()
      table.timestamp('closed_at', { useTz: true }).nullable()
      /** Resumen congelado al cerrar (JSON). */
      table.text('summary').nullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id', 'status'])
    })
    this.schema.raw(`CREATE UNIQUE INDEX shifts_one_open ON shifts (business_id) WHERE status = 'abierto'`)

    this.schema.createTable('cash_sessions', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.integer('shift_id').unsigned().notNullable().references('id').inTable('shifts').onDelete('CASCADE')
      table.integer('cash_register_id').unsigned().notNullable().references('id').inTable('cash_registers').onDelete('CASCADE')
      /** abierta | cerrada */
      table.string('status', 10).notNullable().defaultTo('abierta')
      table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('user_name', 80).nullable()
      table.decimal('opening_float', 12, 2).notNullable().defaultTo(0)
      table.timestamp('opened_at', { useTz: true }).notNullable()
      table.timestamp('closed_at', { useTz: true }).nullable()
      table.integer('closed_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('closed_by_name', 80).nullable()
      /** Correlativo del corte Z por negocio. */
      table.integer('z_number').nullable()
      /** JSON: { efectivo: 120.5, yape: 80 } — lo que se contó/declaró. */
      table.text('declared').nullable()
      /** JSON: lo que el sistema esperaba por método al cerrar. */
      table.text('expected').nullable()
      table.decimal('difference', 12, 2).nullable()
      table.string('note', 255).nullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id', 'status'])
      table.index(['shift_id'])
    })
    // Una caja física no puede tener dos sesiones abiertas a la vez.
    this.schema.raw(
      `CREATE UNIQUE INDEX cash_sessions_one_open_per_register ON cash_sessions (cash_register_id) WHERE status = 'abierta'`
    )

    this.schema.createTable('cash_movements', (table) => {
      table.increments('id')
      table.integer('business_id').unsigned().notNullable().references('id').inTable('businesses').onDelete('CASCADE')
      table.integer('cash_session_id').unsigned().notNullable().references('id').inTable('cash_sessions').onDelete('CASCADE')
      /** ingreso | retiro */
      table.string('type', 10).notNullable()
      table.decimal('amount', 12, 2).notNullable()
      table.string('reason', 160).notNullable()
      table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('user_name', 80).nullable()
      table.timestamp('created_at', { useTz: true })
      table.index(['cash_session_id'])
    })

    this.schema.alterTable('payments', (table) => {
      table.integer('cash_session_id').unsigned().nullable().references('id').inTable('cash_sessions').onDelete('SET NULL')
      table.index(['cash_session_id'])
    })
  }

  async down() {
    this.schema.alterTable('payments', (table) => {
      table.dropIndex(['cash_session_id'])
      table.dropColumn('cash_session_id')
    })
    this.schema.dropTable('cash_movements')
    this.schema.dropTable('cash_sessions')
    this.schema.dropTable('shifts')
    this.schema.dropTable('cash_registers')
  }
}
