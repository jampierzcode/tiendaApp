import { BaseSchema } from '@adonisjs/lucid/schema'
import slugifyLib from 'slugify'

const slugify = (slugifyLib as any).default || slugifyLib

/**
 * Convierte el negocio en algo que se pueda publicar.
 *
 * Hasta ahora `businesses` solo guardaba nombre, descripción y logo, así que
 * literalmente no había dónde poner el número de WhatsApp al que llegan los
 * pedidos, ni cómo darle a cada tienda una dirección pública legible.
 */
export default class extends BaseSchema {
  protected tableName = 'businesses'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Dirección pública: /t/modas-lima en vez de un uuid ilegible.
      table.string('slug', 120).nullable()

      // Pedidos por WhatsApp
      table.string('whatsapp_phone', 20).nullable()
      table.text('whatsapp_message_template').nullable()

      // Contacto y ubicación
      table.string('phone', 20).nullable()
      table.string('email', 150).nullable()
      table.string('address', 255).nullable()
      table.string('city', 100).nullable()
      table.string('instagram', 120).nullable()
      table.string('facebook', 120).nullable()
      table.string('tiktok', 120).nullable()
      table.text('schedule').nullable()

      // Identidad visual de la tienda pública
      table.string('primary_color', 7).notNullable().defaultTo('#111827')
      table.string('secondary_color', 7).notNullable().defaultTo('#F59E0B')
      table.integer('banner_image_id').unsigned().nullable()

      // Comercio
      table.string('currency', 3).notNullable().defaultTo('PEN')
      table.string('currency_symbol', 5).notNullable().defaultTo('S/')
      table.decimal('shipping_cost', 10, 2).notNullable().defaultTo(0)
      table.decimal('free_shipping_from', 10, 2).nullable()

      // La tienda no se publica sola: hay que encenderla.
      table.boolean('is_public').notNullable().defaultTo(false)
    })

    this.defer(async (db) => {
      const businesses = await db.from('businesses').select('id', 'name').orderBy('id', 'asc')
      const taken = new Set<string>()

      for (const business of businesses) {
        const base = slugify(business.name, { lower: true, strict: true }) || `tienda-${business.id}`
        let slug = base
        let suffix = 2

        while (taken.has(slug)) {
          slug = `${base}-${suffix++}`
        }

        taken.add(slug)
        await db.from('businesses').where('id', business.id).update({ slug })
      }
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.string('slug', 120).notNullable().alter()
      table.unique(['slug'], { indexName: 'businesses_slug_unique' })
      table
        .foreign('banner_image_id')
        .references('id')
        .inTable('business_images')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropForeign('banner_image_id')
      table.dropUnique(['slug'], 'businesses_slug_unique')
      table.dropColumn('slug')
      table.dropColumn('whatsapp_phone')
      table.dropColumn('whatsapp_message_template')
      table.dropColumn('phone')
      table.dropColumn('email')
      table.dropColumn('address')
      table.dropColumn('city')
      table.dropColumn('instagram')
      table.dropColumn('facebook')
      table.dropColumn('tiktok')
      table.dropColumn('schedule')
      table.dropColumn('primary_color')
      table.dropColumn('secondary_color')
      table.dropColumn('banner_image_id')
      table.dropColumn('currency')
      table.dropColumn('currency_symbol')
      table.dropColumn('shipping_cost')
      table.dropColumn('free_shipping_from')
      table.dropColumn('is_public')
    })
  }
}
