import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Áreas del comedor (Primer piso, Terraza, Patio…): cada una agrupa sus
 * mesas. Antes era solo un texto en cada mesa (`zone`); se pasa a una tabla
 * para poder crear un área vacía, renombrarla y agregarle mesas. `zone` se
 * sigue llenando con el nombre del área para lo que ya lo lee.
 *
 * No confundir con las áreas de producción (Cocina, Barra), que son a dónde
 * sale cada plato.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('dining_areas', (table) => {
      table.increments('id')
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table.string('name', 40).notNullable()
      table.integer('sort_order').notNullable().defaultTo(0)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.unique(['business_id', 'name'])
    })
    this.schema.alterTable('dining_tables', (table) => {
      table
        .integer('dining_area_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('dining_areas')
        .onDelete('SET NULL')
    })
    this.defer(async (db) => {
      // Cada zona escrita pasa a ser un área; las mesas sin zona quedan en "Salón".
      await db.rawQuery(`
        INSERT INTO dining_areas (business_id, name, created_at, updated_at)
        SELECT DISTINCT business_id, COALESCE(NULLIF(TRIM(zone), ''), 'Salón'), NOW(), NOW() FROM dining_tables
        ON CONFLICT (business_id, name) DO NOTHING`)
      await db.rawQuery(`
        UPDATE dining_tables t SET dining_area_id = a.id, zone = a.name
        FROM dining_areas a
        WHERE a.business_id = t.business_id AND a.name = COALESCE(NULLIF(TRIM(t.zone), ''), 'Salón')`)
    })
  }

  async down() {
    this.schema.alterTable('dining_tables', (table) => table.dropColumn('dining_area_id'))
    this.schema.dropTable('dining_areas')
  }
}
