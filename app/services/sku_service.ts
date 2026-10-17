import db from '@adonisjs/lucid/services/db'

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Letras y números en mayúscula, sin tildes ni símbolos. */
const limpio = (t: string) => sinTildes(t).toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * SKU por defecto: se propone solo, es único dentro del negocio y el usuario
 * puede cambiarlo si su tienda ya tiene un sistema propio.
 *
 *  - Producto:   POL-001 (3 letras del nombre + correlativo)
 *  - Variación:  POL-001-S-NEG (SKU del producto + abreviatura de cada valor)
 *
 * Dos productos con el mismo nombre no chocan: el correlativo avanza.
 */
export default class SkuService {
  static prefijo(nombre: string) {
    const base = limpio(nombre)
    return (base.slice(0, 3) || 'PRD').padEnd(3, 'X')
  }

  private static async existe(tabla: 'products' | 'product_variations', businessId: number, sku: string, excluirId?: number) {
    const q = db.from(tabla).where('business_id', businessId).where('sku', sku)
    if (excluirId) q.whereNot('id', excluirId)
    return Boolean(await q.first())
  }

  /** SKU libre en productos y también en variaciones (comparten espacio). */
  private static async libre(businessId: number, sku: string, excluirProductoId?: number) {
    return (
      !(await this.existe('products', businessId, sku, excluirProductoId)) &&
      !(await this.existe('product_variations', businessId, sku))
    )
  }

  static async sugerirProducto(businessId: number, nombre: string) {
    const pre = this.prefijo(nombre)
    const filas = await db
      .from('products')
      .where('business_id', businessId)
      .where('sku', 'like', `${pre}-%`)
      .select('sku')

    let max = 0
    for (const f of filas) {
      const m = /^[A-Z0-9]{3}-(\d+)$/.exec(String(f.sku))
      if (m) max = Math.max(max, Number(m[1]))
    }

    let n = max + 1
    let sku = `${pre}-${String(n).padStart(3, '0')}`
    while (!(await this.libre(businessId, sku))) {
      n += 1
      sku = `${pre}-${String(n).padStart(3, '0')}`
    }
    return sku
  }

  static async sugerirVariacion(businessId: number, skuProducto: string | null, valores: string[], nombreProducto: string) {
    const base = skuProducto || (await this.sugerirProducto(businessId, nombreProducto))
    const partes = valores.map((v) => limpio(v).slice(0, 3)).filter(Boolean)
    const candidato = [base, ...partes].join('-')

    let sku = candidato
    let n = 2
    while (!(await this.libre(businessId, sku))) {
      sku = `${candidato}-${n}`
      n += 1
    }
    return sku
  }
}
