import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Kardex: el libro mayor del inventario.
 *
 * Hasta ahora el stock era un número suelto en dos tablas a la vez
 * (`products.stock` y `product_variations.stock`), sin fuente de verdad ni
 * rastro de por qué cambió. En cuanto entren la venta en mostrador y la
 * venta online, dos procesos tocando ese número se pisan y el inventario
 * deja de cuadrar.
 *
 * A partir de aquí cada entrada y salida queda escrita en esta tabla, con
 * el saldo resultante y de dónde vino. `product_variations.stock` pasa a
 * ser el saldo materializado que este libro mantiene al día.
 */
export default class extends BaseSchema {
  protected tableName = 'stock_movements'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      table
        .integer('business_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('businesses')
        .onDelete('CASCADE')

      table
        .integer('product_variation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('product_variations')
        .onDelete('CASCADE')

      table
        .enum('type', [
          'compra', // ingreso por orden de compra a proveedor
          'venta', // salida por venta en mostrador o pedido online
          'devolucion', // reingreso por devolución del cliente
          'ajuste', // corrección manual de inventario
          'inicial', // carga inicial del sistema
          'merma', // pérdida, robo o daño
        ])
        .notNullable()

      // Con signo: positivo suma al inventario, negativo lo resta.
      table.integer('quantity').notNullable()
      // Saldo de la variación justo después de aplicar este movimiento.
      table.integer('balance_after').notNullable()

      // Costo unitario del movimiento, para valorizar el inventario.
      table.decimal('unit_cost', 10, 2).nullable()

      // De dónde salió el movimiento, sin acoplarnos todavía a las tablas
      // de ventas y compras (llegan en las entregas 3 y 4).
      table.string('reference_type', 50).nullable()
      table.integer('reference_id').unsigned().nullable()

      table.string('note', 255).nullable()

      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.index(['business_id', 'created_at'], 'stock_movements_business_date_index')
      table.index(['product_variation_id', 'id'], 'stock_movements_variation_index')
      table.index(['reference_type', 'reference_id'], 'stock_movements_reference_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
