import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Unifica el inventario en la variación.
 *
 * El stock vivía a la vez en `products.stock` y en `product_variations.stock`
 * sin regla de cuál mandaba. A partir de aquí:
 *
 *   - Todo producto tiene al menos una variación. Los productos sin tallas
 *     ni colores reciben una variación por defecto (`is_default`), invisible
 *     en el panel.
 *   - El stock real vive solo en `product_variations.stock`, y lo mantiene
 *     el kardex.
 *   - `products.stock` queda como total cacheado, solo de lectura, para no
 *     romper las pantallas que ya lo muestran.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('product_variations', (table) => {
      table.boolean('is_default').notNullable().defaultTo(false)
    })

    this.defer(async (db) => {
      // 1. Una variación por defecto para cada producto que no tenga ninguna.
      const orphanProducts = await db
        .from('products as p')
        .leftJoin('product_variations as v', 'v.product_id', 'p.id')
        .whereNull('v.id')
        .select('p.id', 'p.business_id', 'p.price', 'p.stock', 'p.sku')

      if (orphanProducts.length) {
        await db.table('product_variations').multiInsert(
          orphanProducts.map((product) => ({
            business_id: product.business_id,
            product_id: product.id,
            sku: product.sku,
            is_default: true,
            price: product.price ?? 0,
            stock: product.stock ?? 0,
            price_modifier: 0,
          }))
        )
      }

      // 2. Saldo de apertura del kardex para cada variación con stock.
      const variations = await db
        .from('product_variations')
        .select('id', 'business_id', 'stock')
        .where('stock', '<>', 0)

      if (variations.length) {
        await db.table('stock_movements').multiInsert(
          variations.map((variation) => ({
            business_id: variation.business_id,
            product_variation_id: variation.id,
            type: 'inicial',
            quantity: variation.stock,
            balance_after: variation.stock,
            note: 'Saldo de apertura al migrar al kardex',
          }))
        )
      }

      // 3. `products.stock` pasa a ser el total de sus variaciones.
      await db.rawQuery(`
        UPDATE products
           SET stock = COALESCE((
             SELECT SUM(v.stock) FROM product_variations v WHERE v.product_id = products.id
           ), 0)
      `)
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.from('stock_movements').where('type', 'inicial').delete()
      await db.from('product_variations').where('is_default', true).delete()
    })

    this.schema.alterTable('product_variations', (table) => {
      table.dropColumn('is_default')
    })
  }
}
