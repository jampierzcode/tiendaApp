import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Fuera el modificador de precio.
 *
 * El precio que cobra la tienda era `price + price_modifier`, con lo cual
 * ningún campo por separado era el precio: el panel mostraba 260 y el cliente
 * podía estar viendo 265. Dos sitios para el mismo número es una fuente de
 * errores, no una funcionalidad.
 *
 * El modificador tenía sentido en un diseño donde la variación heredaba el
 * precio del producto y solo guardaba la diferencia ("+5 la XL"), pero aquí
 * cada variación ya guarda su precio completo, así que sobraba.
 *
 * Al aplicarla no se pierde nada: las 87 variaciones existentes lo tenían en
 * 0. Si hiciera falta volver atrás, `down()` devuelve la columna.
 */
export default class extends BaseSchema {
  protected tableName = 'product_variations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('price_modifier')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('price_modifier', 10, 2).defaultTo(0)
    })
  }
}
