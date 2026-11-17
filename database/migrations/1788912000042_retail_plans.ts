import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Planes de tienda (retail): Catálogo / Tienda online / Tienda + IA.
 *
 * Además, los planes de restaurante que ya incluían pedidos en línea ganan la
 * clave `envios` (antes el delivery venía dentro de `pedidos_online`): así no
 * pierden nada ahora que los envíos se controlan aparte.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const ahora = new Date()

      const conPedidos = await db.from('plans').where('business_type', 'restaurant')
      for (const p of conPedidos) {
        const lista: string[] = JSON.parse(p.features ?? '[]')
        if (lista.includes('pedidos_online') && !lista.includes('envios')) {
          lista.splice(lista.indexOf('pedidos_online') + 1, 0, 'envios')
          await db
            .from('plans')
            .where('id', p.id)
            .update({ features: JSON.stringify(lista), updated_at: ahora })
        }
      }

      const planes = [
        {
          key: 'tienda_catalogo',
          name: 'Catálogo',
          tagline: 'Tu catálogo con QR y link para redes; los pedidos te llegan por WhatsApp.',
          features: ['carta', 'qr', 'promociones', 'inventario'],
          is_featured: false,
          sort_order: 1,
          precios: { month: 15, year: 150 },
        },
        {
          key: 'tienda_online',
          name: 'Tienda online',
          tagline: 'Pedidos en línea, envíos con seguimiento y caja en tu local.',
          features: [
            'carta',
            'qr',
            'promociones',
            'inventario',
            'pedidos_online',
            'envios',
            'cuentas_cliente',
            'pos',
            'reportes',
          ],
          is_featured: true,
          sort_order: 2,
          precios: { month: 39.9, year: 399 },
        },
        {
          key: 'tienda_ia',
          name: 'Tienda + IA',
          tagline: 'Tu WhatsApp vende solo, las 24 horas, y controlas compras y márgenes.',
          features: [
            'carta',
            'qr',
            'promociones',
            'inventario',
            'pedidos_online',
            'envios',
            'cuentas_cliente',
            'pos',
            'reportes',
            'whatsapp',
            'vendedor_ia',
            'compras',
          ],
          is_featured: false,
          sort_order: 3,
          precios: { month: 79.9, year: 799 },
        },
      ]

      for (const p of planes) {
        const existe = await db.from('plans').where('key', p.key).first()
        if (existe) continue
        const [fila] = await db
          .table('plans')
          .insert({
            key: p.key,
            name: p.name,
            tagline: p.tagline,
            business_type: 'retail',
            features: JSON.stringify(p.features),
            is_featured: p.is_featured,
            is_active: true,
            sort_order: p.sort_order,
            created_at: ahora,
            updated_at: ahora,
          })
          .returning('id')
        const planId = typeof fila === 'object' ? fila.id : fila
        for (const [interval, price] of Object.entries(p.precios)) {
          await db.table('plan_prices').insert({
            plan_id: planId,
            interval,
            price,
            currency: 'PEN',
            is_active: true,
            created_at: ahora,
            updated_at: ahora,
          })
        }
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      await db
        .from('plans')
        .whereIn('key', ['tienda_catalogo', 'tienda_online', 'tienda_ia'])
        .delete()
    })
  }
}
