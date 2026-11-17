import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Planes comerciales y su historial de suscripciones.
 *
 * - `plans`: Carta / Pedidos / Pedidos + IA (por rubro). `features` es un JSON
 *   con las claves de función que incluye (ver services/plan_features.ts).
 * - `plan_prices`: cada plan tiene su precio mensual y anual (u otros
 *   intervalos), editables por el superadmin.
 * - `subscriptions`: una fila por cada período contratado o prueba. Es el
 *   historial que ve el dueño en "Mi plan"; nunca se borra, solo se anula.
 *
 * `businesses.plan_id` queda como atajo al plan vigente. Un negocio sin plan
 * (todos los que existían antes de esto) conserva acceso completo.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plans', (table) => {
      table.increments('id')
      table.string('key', 60).notNullable().unique()
      table.string('name', 80).notNullable()
      table.string('tagline', 160).nullable()
      table.text('description').nullable()
      /** restaurant | retail | null (cualquiera). */
      table.string('business_type', 20).nullable()
      table.text('features').notNullable().defaultTo('[]')
      /** Se destaca como "Más elegido" en la comparación. */
      table.boolean('is_featured').notNullable().defaultTo(false)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.integer('sort_order').notNullable().defaultTo(0)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
    })

    this.schema.createTable('plan_prices', (table) => {
      table.increments('id')
      table
        .integer('plan_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plans')
        .onDelete('CASCADE')
      /** month | year */
      table.string('interval', 10).notNullable()
      table.decimal('price', 10, 2).notNullable()
      table.string('currency', 3).notNullable().defaultTo('PEN')
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.unique(['plan_id', 'interval'])
    })

    this.schema.createTable('subscriptions', (table) => {
      table.increments('id')
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('plan_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('plans')
        .onDelete('SET NULL')
      table
        .integer('plan_price_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('plan_prices')
        .onDelete('SET NULL')
      /** Copia del nombre del plan: el historial no cambia si el plan se renombra. */
      table.string('plan_name', 80).notNullable()
      /** trial | month | year */
      table.string('interval', 10).notNullable()
      table.integer('quantity').notNullable().defaultTo(1)
      table.decimal('unit_price', 10, 2).notNullable().defaultTo(0)
      table.decimal('total', 10, 2).notNullable().defaultTo(0)
      table.string('currency', 3).notNullable().defaultTo('PEN')
      table.timestamp('starts_at', { useTz: true }).notNullable()
      table.timestamp('ends_at', { useTz: true }).notNullable()
      /** trial | active | cancelled. "Vencida" se deduce de ends_at. */
      table.string('status', 12).notNullable().defaultTo('active')
      table.string('payment_method', 40).nullable()
      table.string('payment_reference', 120).nullable()
      table.text('notes').nullable()
      table
        .integer('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('cancelled_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id', 'ends_at'])
    })

    this.schema.alterTable('businesses', (table) => {
      table
        .integer('plan_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('plans')
        .onDelete('SET NULL')
    })

    // Planes de restaurante con sus precios (editables luego desde el superadmin).
    this.defer(async (db) => {
      const ahora = new Date()
      const planes = [
        {
          key: 'restaurante_carta',
          name: 'Carta',
          tagline: 'Tu carta digital con QR, lista en minutos.',
          features: ['carta', 'qr', 'promociones'],
          is_featured: false,
          sort_order: 1,
          precios: { month: 15, year: 150 },
        },
        {
          key: 'restaurante_pedidos',
          name: 'Pedidos',
          tagline: 'Recibe pedidos en línea y organiza tu cocina.',
          features: [
            'carta',
            'qr',
            'promociones',
            'pedidos_online',
            'cocina',
            'cuentas_cliente',
            'pos',
            'reportes',
          ],
          is_featured: true,
          sort_order: 2,
          precios: { month: 39.9, year: 399 },
        },
        {
          key: 'restaurante_ia',
          name: 'Pedidos + IA',
          tagline: 'Tu WhatsApp vende solo, las 24 horas.',
          features: [
            'carta',
            'qr',
            'promociones',
            'pedidos_online',
            'cocina',
            'cuentas_cliente',
            'pos',
            'reportes',
            'whatsapp',
            'vendedor_ia',
            'insumos',
          ],
          is_featured: false,
          sort_order: 3,
          precios: { month: 79.9, year: 799 },
        },
      ]

      for (const p of planes) {
        const [fila] = await db
          .table('plans')
          .insert({
            key: p.key,
            name: p.name,
            tagline: p.tagline,
            business_type: 'restaurant',
            features: JSON.stringify(p.features),
            is_featured: p.is_featured,
            is_active: true,
            sort_order: p.sort_order,
            created_at: ahora,
            updated_at: ahora,
          })
          .returning('id')
        const planId = typeof fila === 'object' ? fila.id : fila
        for (const [interval, price] of Object.entries(p.precios)) {
          await db.table('plan_prices').insert({
            plan_id: planId,
            interval,
            price,
            currency: 'PEN',
            is_active: true,
            created_at: ahora,
            updated_at: ahora,
          })
        }
      }
    })
  }

  async down() {
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('plan_id')
    })
    this.schema.dropTable('subscriptions')
    this.schema.dropTable('plan_prices')
    this.schema.dropTable('plans')
  }
}
