import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Añade `business_id` a todas las tablas que colgaban de un negocio solo de
 * forma indirecta.
 *
 * Sin esta columna, controladores como product_variations o discounts no
 * tenían forma barata de filtrar por negocio y terminaban sirviendo (y
 * dejando modificar) datos de cualquier tienda con solo mandar el id.
 * Con la columna, cada consulta puede llevar `where business_id = ?` sin
 * joins, y el valor lo pone siempre el servidor desde `ctx.business`.
 */
export default class extends BaseSchema {
  /** tabla -> [tabla padre, columna FK hacia el padre] */
  private targets: Array<[string, string, string]> = [
    ['subcategories', 'categories', 'category_id'],
    ['product_attribute_values', 'product_attributes', 'attribute_id'],
    ['product_variations', 'products', 'product_id'],
    ['category_product', 'products', 'product_id'],
    ['discounts', 'products', 'product_id'],
    ['product_variation_attributes', 'product_variations', 'variation_id'],
  ]

  async up() {
    // 1. La columna entra nullable para poder rellenarla.
    for (const [table] of this.targets) {
      this.schema.alterTable(table, (t) => {
        t.integer('business_id').unsigned().nullable()
      })
    }

    // 2. Se hereda el negocio del padre.
    this.defer(async (db) => {
      for (const [table, parent, foreignKey] of this.targets) {
        // Subconsulta correlacionada en vez de UPDATE...JOIN: aquélla es
        // sintaxis exclusiva de MySQL, ésta es SQL estándar.
        await db.rawQuery(
          `UPDATE ??
              SET business_id = (
                SELECT parent.business_id FROM ?? AS parent WHERE parent.id = ??.??
              )`,
          [table, parent, table, foreignKey]
        )
      }

      // Si algo quedó huérfano no puede pertenecer a ningún negocio.
      for (const [table] of this.targets) {
        await db.rawQuery(`DELETE FROM ?? WHERE business_id IS NULL`, [table])
      }
    })

    // 3. Ya con datos, se cierra: obligatoria, con FK e índice.
    for (const [table] of this.targets) {
      this.schema.alterTable(table, (t) => {
        t.integer('business_id').unsigned().notNullable().alter()
        t.foreign('business_id').references('id').inTable('businesses').onDelete('CASCADE')
        t.index('business_id', `${table}_business_id_index`)
      })
    }
  }

  async down() {
    for (const [table] of this.targets) {
      this.schema.alterTable(table, (t) => {
        t.dropForeign('business_id')
        t.dropIndex('business_id', `${table}_business_id_index`)
        t.dropColumn('business_id')
      })
    }
  }
}
