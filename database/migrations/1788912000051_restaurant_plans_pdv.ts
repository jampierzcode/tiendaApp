import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Planes de restaurante en escalera (2026-11-20):
 *   Carta S/15 → PDV S/39.90 → Pedidos en línea + IA S/79.90
 * más el complemento Inventario (+S/10) sobre PDV, incluido en el plan IA.
 *
 * Nada se le quita a quien ya paga: el plan "Pedidos" (con pedidos online)
 * queda oculto para clientes nuevos pero sus negocios lo conservan igual; el
 * plan "Pedidos + IA" solo gana el PDV. "PDV" es un plan nuevo.
 *
 * `businesses.extra_features`: complementos activados por negocio (JSON).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.text('extra_features').nullable()
    })

    this.defer(async (db) => {
      const ahora = new Date()
      await db
        .from('plans')
        .where('key', 'restaurante_pedidos')
        .update({ is_active: false, is_featured: false, updated_at: ahora })

      const existe = await db.from('plans').where('key', 'restaurante_pdv').first()
      if (!existe) {
        const [fila] = await db
          .table('plans')
          .insert({
            key: 'restaurante_pdv',
            name: 'PDV',
            tagline: 'Tu local completo: mesas, caja, cocina e impresión.',
            business_type: 'restaurant',
            features: JSON.stringify(['carta', 'qr', 'promociones', 'salon', 'reportes']),
            is_featured: true,
            is_active: true,
            sort_order: 2,
            created_at: ahora,
            updated_at: ahora,
          })
          .returning('id')
        const id = typeof fila === 'object' ? fila.id : fila
        await db.table('plan_prices').multiInsert([
          {
            plan_id: id,
            interval: 'month',
            price: 39.9,
            currency: 'PEN',
            is_active: true,
            created_at: ahora,
            updated_at: ahora,
          },
          {
            plan_id: id,
            interval: 'year',
            price: 399,
            currency: 'PEN',
            is_active: true,
            created_at: ahora,
            updated_at: ahora,
          },
        ])
      }

      // El plan IA solo suma (PDV), así nadie pierde nada.
      const ia = await db.from('plans').where('key', 'restaurante_ia').first()
      if (ia) {
        const actuales: string[] = JSON.parse(ia.features ?? '[]')
        const nuevas = [...new Set([...actuales, 'salon', 'insumos'])]
        await db
          .from('plans')
          .where('id', ia.id)
          .update({
            name: 'Pedidos en línea + IA',
            tagline: 'Tu local, tu tienda online y un vendedor IA en WhatsApp.',
            features: JSON.stringify(nuevas),
            sort_order: 3,
            updated_at: ahora,
          })
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      await db
        .from('plans')
        .where('key', 'restaurante_pedidos')
        .update({ is_active: true, is_featured: true })
      await db.from('plans').where('key', 'restaurante_pdv').update({ is_active: false })
      await db
        .from('plans')
        .where('key', 'restaurante_ia')
        .update({ name: 'Pedidos + IA', tagline: 'Tu WhatsApp vende solo, las 24 horas.' })
    })
    this.schema.alterTable('businesses', (table) => table.dropColumn('extra_features'))
  }
}
