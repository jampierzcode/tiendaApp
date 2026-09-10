import { BaseSchema } from '@adonisjs/lucid/schema'
import slugifyLib from 'slugify'

const slugify = (slugifyLib as any).default || slugifyLib

/**
 * Completa el producto con lo que el sistema de gestión necesita y no tenía:
 *
 * - `cost`: sin precio de costo era imposible calcular márgenes, y los
 *   márgenes son un entregable de la proforma.
 * - `sku` y `slug`: código interno y URL pública del producto.
 * - `tax_rate`: IGV por producto (18% por defecto en Perú), necesario para
 *   los tickets y para los reportes de utilidad.
 * - `low_stock_threshold`: alimenta las alertas de inventario.
 */
export default class extends BaseSchema {
  protected tableName = 'products'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('cost', 10, 2).nullable()
      table.string('sku', 100).nullable()
      table.string('slug', 255).nullable()
      table.decimal('tax_rate', 5, 2).notNullable().defaultTo(18.0)
      table.integer('low_stock_threshold').unsigned().notNullable().defaultTo(5)
    })

    // Slug a partir del nombre, único dentro de cada negocio.
    this.defer(async (db) => {
      const products = await db
        .from('products')
        .select('id', 'business_id', 'name')
        .orderBy('id', 'asc')

      const takenByBusiness = new Map<number, Set<string>>()

      for (const product of products) {
        const taken = takenByBusiness.get(product.business_id) ?? new Set<string>()
        takenByBusiness.set(product.business_id, taken)

        const base = slugify(product.name, { lower: true, strict: true }) || `producto-${product.id}`
        let slug = base
        let suffix = 2

        while (taken.has(slug)) {
          slug = `${base}-${suffix++}`
        }

        taken.add(slug)
        await db.from('products').where('id', product.id).update({ slug })
      }
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.string('slug', 255).notNullable().alter()
      table.unique(['business_id', 'slug'], { indexName: 'products_business_slug_unique' })
      table.unique(['business_id', 'sku'], { indexName: 'products_business_sku_unique' })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['business_id', 'slug'], 'products_business_slug_unique')
      table.dropUnique(['business_id', 'sku'], 'products_business_sku_unique')
      table.dropColumn('cost')
      table.dropColumn('sku')
      table.dropColumn('slug')
      table.dropColumn('tax_rate')
      table.dropColumn('low_stock_threshold')
    })
  }
}
