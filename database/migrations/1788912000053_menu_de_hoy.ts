import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Lo que hay hoy, encima de la carta completa (sin tocar el estado del plato):
 *  - Categoría «cambia cada día» (Menú del día): cada día se eligen sus platos;
 *    si ese día no se eligió ninguno, se muestran todos.
 *  - «Se acabó hoy» en cualquier plato: vuelve solo al día siguiente.
 * Las fechas son del día en Lima, como texto AAAA-MM-DD (sin líos de zona horaria).
 *
 * Y en la carta pública, qué hace WhatsApp cuando el plan no tiene pedidos en línea:
 * ninguno (solo ver), consultar (botón por plato) o pedir (carrito por WhatsApp).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('categories', (table) => {
      table.boolean('daily_menu').notNullable().defaultTo(false)
    })
    this.schema.alterTable('products', (table) => {
      table.string('menu_date', 10).nullable()
      table.string('sold_out_date', 10).nullable()
    })
    this.schema.alterTable('businesses', (table) => {
      // 'pedir' conserva lo que ya veían los negocios del plan Carta.
      table.string('carta_whatsapp', 10).notNullable().defaultTo('pedir')
    })
  }

  async down() {
    this.schema.alterTable('categories', (table) => table.dropColumn('daily_menu'))
    this.schema.alterTable('products', (table) => {
      table.dropColumn('menu_date')
      table.dropColumn('sold_out_date')
    })
    this.schema.alterTable('businesses', (table) => table.dropColumn('carta_whatsapp'))
  }
}
