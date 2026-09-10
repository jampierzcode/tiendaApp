import db from '@adonisjs/lucid/services/db'
import slugifyLib from 'slugify'

const slugify = (slugifyLib as any).default || slugifyLib

/**
 * Genera un slug único dentro de un negocio.
 *
 * La unicidad es por negocio, no global: dos tiendas distintas pueden tener
 * ambas una categoría "polos" sin pisarse.
 */
export default class SlugService {
  static async uniqueFor(
    table: string,
    businessId: number,
    name: string,
    ignoreId?: number
  ): Promise<string> {
    const base = slugify(name, { lower: true, strict: true }) || 'sin-nombre'
    let slug = base
    let suffix = 2

    while (await this.exists(table, businessId, slug, ignoreId)) {
      slug = `${base}-${suffix++}`
    }

    return slug
  }

  /**
   * Slug único en toda la base. Lo usan los negocios: dos tiendas no pueden
   * compartir dirección pública porque /t/<slug> tiene que ser inequívoco.
   */
  static async uniqueSlugGlobal(table: string, name: string, ignoreId?: number): Promise<string> {
    const base = slugify(name, { lower: true, strict: true }) || 'tienda'
    let slug = base
    let suffix = 2

    while (true) {
      const query = db.from(table).where('slug', slug)
      if (ignoreId) query.whereNot('id', ignoreId)
      const match = await query.select('id').first()
      if (!match) return slug
      slug = `${base}-${suffix++}`
    }
  }

  private static async exists(
    table: string,
    businessId: number,
    slug: string,
    ignoreId?: number
  ): Promise<boolean> {
    const query = db.from(table).where('business_id', businessId).where('slug', slug)

    if (ignoreId) {
      query.whereNot('id', ignoreId)
    }

    const match = await query.select('id').first()
    return Boolean(match)
  }
}
