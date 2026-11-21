import Category from '#models/category'
import Product from '#models/product'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

/** El día del local (Lima), como AAAA-MM-DD. */
export function hoyLocal() {
  return DateTime.now().setZone('America/Lima').toISODate()!
}

export interface DisponibilidadHoy {
  hoy: string
  /** Platos que no se muestran hoy: de un Menú del día que ya se eligió y no entraron. */
  ocultos: Set<number>
  /** Platos que se acabaron hoy: se ven en gris y no se venden. */
  agotados: Set<number>
}

/**
 * Lo que hay hoy, encima de la carta completa:
 *  - Categoría «cambia cada día»: si hoy se eligió al menos un plato de ella,
 *    los demás de esa categoría no se muestran. Si nadie eligió nada, se ven
 *    todos (olvidarse no deja la carta vacía).
 *  - «Se acabó hoy»: el plato se ve pero no se vende; mañana vuelve solo.
 */
export default class MenuHoyService {
  static async disponibilidad(businessId: number): Promise<DisponibilidadHoy> {
    const hoy = hoyLocal()

    const agotadas = await db
      .from('products')
      .where('business_id', businessId)
      .andWhere('sold_out_date', hoy)
      .select('id')
    const agotados = new Set<number>(agotadas.map((r) => Number(r.id)))

    const ocultos = new Set<number>()
    const diarias = await db
      .from('categories')
      .where('business_id', businessId)
      .andWhere('daily_menu', true)
      .select('id')
    if (diarias.length) {
      const enlaces = await db
        .from('category_product as cp')
        .join('products as p', 'p.id', 'cp.product_id')
        .whereIn(
          'cp.category_id',
          diarias.map((d) => d.id)
        )
        .select('cp.category_id', 'p.id', 'p.menu_date')
      const elegidaHoy = new Set<number>()
      for (const e of enlaces) if (e.menu_date === hoy) elegidaHoy.add(Number(e.category_id))
      for (const e of enlaces) {
        if (elegidaHoy.has(Number(e.category_id)) && e.menu_date !== hoy) ocultos.add(Number(e.id))
      }
      // Si además está en una categoría normal, sigue visible ahí: no se oculta.
      if (ocultos.size) {
        const normales = await db
          .from('category_product as cp')
          .join('categories as c', 'c.id', 'cp.category_id')
          .whereIn('cp.product_id', [...ocultos])
          .andWhere('c.daily_menu', false)
          .select('cp.product_id')
        for (const n of normales) ocultos.delete(Number(n.product_id))
      }
    }
    return { hoy, ocultos, agotados }
  }

  /** Pantalla «Menú de hoy»: todas las categorías con sus platos activos y lo marcado hoy. */
  static async pantalla(businessId: number) {
    const hoy = hoyLocal()
    const categorias = await Category.query()
      .where('business_id', businessId)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
    const productos = await Product.query()
      .where('business_id', businessId)
      .andWhere('status', 'activo')
      .preload('businessImages')
      .preload('categoryLinks')
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')

    // Último día anterior con menú elegido, para «Repetir el último menú».
    const ultimo = await db
      .from('products')
      .where('business_id', businessId)
      .whereNotNull('menu_date')
      .andWhere('menu_date', '<', hoy)
      .max('menu_date as fecha')
      .first()

    const plato = (p: Product) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.businessImages?.url ?? null,
      price: Number(p.price),
      elegido: p.menuDate === hoy,
      agotado: p.soldOutDate === hoy,
    })

    const usados = new Set<number>()
    const lista = categorias
      .map((c) => {
        const suyos = productos.filter((p) => p.categoryLinks.some((l) => l.categoryId === c.id))
        suyos.forEach((p) => usados.add(p.id))
        return {
          id: c.id,
          name: c.name,
          isActive: c.isActive,
          dailyMenu: c.dailyMenu,
          platos: suyos.map(plato),
        }
      })
      .filter((c) => c.platos.length)
    const sueltos = productos.filter((p) => !usados.has(p.id))
    if (sueltos.length) {
      lista.push({ id: 0, name: 'Sin categoría', isActive: true, dailyMenu: false, platos: sueltos.map(plato) })
    }

    return { hoy, ultimoMenu: (ultimo?.fecha as string | null) ?? null, categorias: lista }
  }

  static async marcarCategoria(businessId: number, categoryId: number, dailyMenu: boolean) {
    const c = await Category.query()
      .where('business_id', businessId)
      .andWhere('id', categoryId)
      .firstOrFail()
    c.dailyMenu = dailyMenu
    await c.save()
  }

  /** Elegir o quitar un plato del menú de hoy, y/o marcarlo agotado hoy. */
  static async marcarPlato(
    businessId: number,
    productId: number,
    cambios: { elegido?: boolean; agotado?: boolean }
  ) {
    const hoy = hoyLocal()
    const p = await Product.query()
      .where('business_id', businessId)
      .andWhere('id', productId)
      .firstOrFail()
    if (cambios.elegido !== undefined) p.menuDate = cambios.elegido ? hoy : null
    if (cambios.agotado !== undefined) p.soldOutDate = cambios.agotado ? hoy : null
    await p.save()
    return { id: p.id, elegido: p.menuDate === hoy, agotado: p.soldOutDate === hoy }
  }

  /** Copia a hoy los platos del último menú elegido (en las categorías «cambia cada día»). */
  static async repetirUltimo(businessId: number) {
    const hoy = hoyLocal()
    const ultimo = await db
      .from('products')
      .where('business_id', businessId)
      .whereNotNull('menu_date')
      .andWhere('menu_date', '<', hoy)
      .max('menu_date as fecha')
      .first()
    if (!ultimo?.fecha) return { copiados: 0 }
    const n = await db
      .from('products')
      .where('business_id', businessId)
      .andWhere('menu_date', ultimo.fecha)
      .update({ menu_date: hoy })
    return { copiados: Array.isArray(n) ? n.length : Number(n) }
  }
}
