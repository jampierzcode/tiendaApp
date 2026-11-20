import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Módulo de Inventario (restaurante), aparte del PDV.
 *
 *  - Insumo: categoría, unidad de compra y su conversión (1 saco = 50 kg).
 *  - Preparación (subreceta): un insumo que se produce con otros (salsa, masa)
 *    y rinde una cantidad por tanda. Los platos la usan como cualquier insumo.
 *  - Compras a proveedores: suben stock y recalculan el costo promedio.
 *  - Conteo físico: lo contado contra lo que dice el sistema; la diferencia se
 *    ajusta sola al cerrar el conteo.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('ingredients', (table) => {
      table.string('category', 60).nullable()
      /** insumo | preparacion */
      table.string('kind', 12).notNullable().defaultTo('insumo')
      /** Cómo se compra: saco, caja, botella… (null = en la misma unidad). */
      table.string('purchase_unit', 20).nullable()
      /** Cuántas unidades de uso trae una unidad de compra (1 saco = 50 kg). */
      table.decimal('purchase_factor', 14, 4).notNullable().defaultTo(1)
      /** Preparación: cuánto rinde una tanda (en su unidad). */
      table.decimal('yield_qty', 14, 3).nullable()
    })

    this.schema.createTable('ingredient_components', (table) => {
      table.increments('id')
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      /** La preparación. */
      table
        .integer('ingredient_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('CASCADE')
      /** Lo que lleva por tanda. */
      table
        .integer('component_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('RESTRICT')
      table.decimal('quantity', 14, 4).notNullable()
      table.timestamp('created_at', { useTz: true })
      table.index(['ingredient_id'])
    })

    this.schema.createTable('ingredient_purchases', (table) => {
      table.increments('id')
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      table
        .integer('supplier_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('suppliers')
        .onDelete('SET NULL')
      /** Factura, boleta o guía del proveedor. */
      table.string('document', 40).nullable()
      table.date('purchased_on').notNullable()
      table.decimal('total', 12, 2).notNullable().defaultTo(0)
      /** registrada | anulada */
      table.string('status', 12).notNullable().defaultTo('registrada')
      table.string('note', 255).nullable()
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id', 'purchased_on'])
    })

    this.schema.createTable('ingredient_purchase_lines', (table) => {
      table.increments('id')
      table
        .integer('purchase_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredient_purchases')
        .onDelete('CASCADE')
      table
        .integer('ingredient_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('RESTRICT')
      /** Lo que dice la factura: 2 sacos a S/ 120. */
      table.decimal('quantity', 14, 3).notNullable()
      table.string('unit_label', 20).notNullable()
      table.decimal('factor', 14, 4).notNullable().defaultTo(1)
      table.decimal('unit_price', 12, 4).notNullable()
      table.decimal('line_total', 12, 2).notNullable()
      /** Convertido a la unidad de uso: 100 kg. */
      table.decimal('base_quantity', 14, 3).notNullable()
    })

    this.schema.createTable('inventory_counts', (table) => {
      table.increments('id')
      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')
      /** borrador | cerrado */
      table.string('status', 12).notNullable().defaultTo('borrador')
      /** Solo una categoría, o null = todo. */
      table.string('category', 60).nullable()
      table.string('note', 255).nullable()
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('closed_by_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('closed_at', { useTz: true }).nullable()
      table.decimal('difference_value', 12, 2).nullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.index(['business_id', 'status'])
    })

    this.schema.createTable('inventory_count_lines', (table) => {
      table.increments('id')
      table
        .integer('count_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('inventory_counts')
        .onDelete('CASCADE')
      table
        .integer('ingredient_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onDelete('CASCADE')
      /** Lo que había en el sistema al cerrar. */
      table.decimal('expected', 14, 3).nullable()
      /** Lo que se contó (null = no se contó, no se ajusta). */
      table.decimal('counted', 14, 3).nullable()
      table.decimal('difference', 14, 3).nullable()
      table.decimal('unit_cost', 12, 4).nullable()
      table.unique(['count_id', 'ingredient_id'])
    })
  }

  async down() {
    this.schema.dropTable('inventory_count_lines')
    this.schema.dropTable('inventory_counts')
    this.schema.dropTable('ingredient_purchase_lines')
    this.schema.dropTable('ingredient_purchases')
    this.schema.dropTable('ingredient_components')
    this.schema.alterTable('ingredients', (table) => {
      for (const c of ['category', 'kind', 'purchase_unit', 'purchase_factor', 'yield_qty'])
        table.dropColumn(c)
    })
  }
}
