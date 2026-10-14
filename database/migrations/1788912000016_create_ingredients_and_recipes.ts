import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Insumos y recetas (modo restaurante).
 *
 * Un plato no tiene stock propio: lo que se agota es la carne, el pan, el
 * queso. La receta dice cuánto de cada insumo lleva un plato, y confirmar el
 * pedido descuenta esas cantidades. Mismo modelo que el inventario del POS
 * (insumo → movimientos → receta → consumo), en versión mínima: una sola
 * unidad por insumo y un solo almacén.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ingredients', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table.string('name', 150).notNullable()
      // kg, g, l, ml, und… Las recetas se escriben en esta misma unidad.
      table.string('unit', 10).notNullable().defaultTo('und')
      table.decimal('stock', 14, 3).notNullable().defaultTo(0)
      table.decimal('min_stock', 14, 3).notNullable().defaultTo(0)
      // Costo promedio ponderado por unidad; se actualiza con cada compra.
      table.decimal('avg_cost', 12, 4).notNullable().defaultTo(0)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
      table.unique(['business_id', 'name'], { indexName: 'ingredients_business_name_unique' })
    })

    // Libro de movimientos: solo se agrega, nunca se edita.
    this.schema.createTable('ingredient_movements', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('ingredient_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('CASCADE')
      // inicial | compra | ajuste | merma | consumo | devolucion
      table.string('type', 15).notNullable()
      // Con signo: negativo descuenta.
      table.decimal('quantity', 14, 3).notNullable()
      table.decimal('unit_cost', 12, 4).nullable()
      table.decimal('stock_after', 14, 3).notNullable()
      table.string('reference_type', 20).nullable()
      table.integer('reference_id').unsigned().nullable()
      table.string('note', 255).nullable()
      table.integer('user_id').unsigned().nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.index(['ingredient_id', 'id'], 'ingredient_movements_ingredient_index')
      table.index(['reference_type', 'reference_id'], 'ingredient_movements_reference_index')
    })

    this.schema.createTable('recipes', (table) => {
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
        .unique()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })

    this.schema.createTable('recipe_lines', (table) => {
      table.increments('id').notNullable()
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('recipe_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('recipes')
        .onDelete('CASCADE')
      table
        .integer('ingredient_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('RESTRICT')
      table.decimal('quantity', 14, 4).notNullable()
      // 0-100: lo que se pierde al preparar y también se descuenta.
      table.decimal('waste_percent', 5, 2).notNullable().defaultTo(0)
    })

    // Un extra («queso extra») puede consumir su propio insumo.
    this.schema.alterTable('modifier_options', (table) => {
      table
        .integer('ingredient_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('SET NULL')
      table.decimal('ingredient_qty', 14, 4).notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable('modifier_options', (table) => {
      table.dropColumn('ingredient_qty')
      table.dropColumn('ingredient_id')
    })
    this.schema.dropTable('recipe_lines')
    this.schema.dropTable('recipes')
    this.schema.dropTable('ingredient_movements')
    this.schema.dropTable('ingredients')
  }
}
