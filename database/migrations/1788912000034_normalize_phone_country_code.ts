import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Los teléfonos pasan a guardarse siempre con código de país (51933173580).
 * Los contactos y pedidos viejos que quedaron con el número nacional
 * (933173580) reciben el código del país de su tienda. Si ya existe otro
 * contacto con el número completo, ese se deja como está para no chocar con
 * la regla de teléfono único por tienda.
 */
const PAISES = [
  { codigo: 'PE', dial: '51', largo: 9, inicio: '9' },
  { codigo: 'MX', dial: '52', largo: 10, inicio: '' },
  { codigo: 'CL', dial: '56', largo: 9, inicio: '9' },
]

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const p of PAISES) {
        const patron = `^${p.inicio}[0-9]{${p.largo - p.inicio.length}}$`
        await db.rawQuery(
          `update customers c set phone = ? || c.phone
             from businesses b
            where b.id = c.business_id and b.country = ?
              and c.phone ~ ?
              and not exists (
                select 1 from customers x
                 where x.business_id = c.business_id and x.phone = ? || c.phone)`,
          [p.dial, p.codigo, patron, p.dial]
        )
        await db.rawQuery(
          `update orders o set customer_phone = ? || o.customer_phone
             from businesses b
            where b.id = o.business_id and b.country = ?
              and o.customer_phone ~ ?`,
          [p.dial, p.codigo, patron]
        )
      }
    })
  }

  async down() {
    // No se deshace: quitar el código de país volvería a dejar teléfonos ambiguos.
  }
}
