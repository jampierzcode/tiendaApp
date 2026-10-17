import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Promociones v2:
 *  - Varios destinos a la vez (productos, variaciones y categorías) en
 *    `discount_targets`; la promoción usa `scope = 'selection'`.
 *  - Días de la semana (`weekdays`, 1 = lunes … 7 = domingo): promociones
 *    recurrentes como «todos los viernes y sábados de este mes».
 *
 * Las promociones que apuntaban a un producto o categoría pasan a ser una
 * selección con ese único destino.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('discount_targets', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('discount_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('discounts')
        .onDelete('CASCADE')
      table.enum('kind', ['product', 'variation', 'category']).notNullable()
      table.integer('target_id').unsigned().notNullable()

      table.unique(['discount_id', 'kind', 'target_id'], { indexName: 'discount_targets_unique' })
      table.index(['business_id', 'kind', 'target_id'], 'discount_targets_lookup_index')
    })

    this.schema.alterTable('discounts', (table) => {
      table.string('weekdays', 20).nullable()
    })

    this.schema.raw('ALTER TABLE discounts DROP CONSTRAINT IF EXISTS discounts_scope_check')
    this.schema.raw(
      `ALTER TABLE discounts ADD CONSTRAINT discounts_scope_check CHECK (scope IN ('all','category','product','selection'))`
    )

    this.schema.raw(
      `INSERT INTO discount_targets (business_id, discount_id, kind, target_id)
         SELECT business_id, id, 'product', product_id FROM discounts
          WHERE scope = 'product' AND product_id IS NOT NULL`
    )
    this.schema.raw(
      `INSERT INTO discount_targets (business_id, discount_id, kind, target_id)
         SELECT business_id, id, 'category', category_id FROM discounts
          WHERE scope = 'category' AND category_id IS NOT NULL`
    )
    this.schema.raw(`UPDATE discounts SET scope = 'selection' WHERE scope IN ('product', 'category')`)
  }

  async down() {
    this.schema.raw("UPDATE discounts SET scope = 'all' WHERE scope = 'selection'")
    this.schema.raw('ALTER TABLE discounts DROP CONSTRAINT IF EXISTS discounts_scope_check')
    this.schema.raw(
      `ALTER TABLE discounts ADD CONSTRAINT discounts_scope_check CHECK (scope IN ('all','category','product'))`
    )
    this.schema.alterTable('discounts', (table) => {
      table.dropColumn('weekdays')
    })
    this.schema.dropTableIfExists('discount_targets')
  }
}
