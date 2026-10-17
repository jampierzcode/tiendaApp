import CategoryProduct from '#models/category_product'
import db from '@adonisjs/lucid/services/db'
import Discount from '#models/discount'
import type Business from '#models/business'
import Category from '#models/category'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import { PAISES, type CodigoPais } from '#services/countries'
import PricingService from '#services/pricing_service'
import { DateTime } from 'luxon'

const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export interface LineaPromo {
  productId: number
  variationId?: number
  categoryIds: number[]
  precioUnit: number
  cantidad: number
}

export interface ResultadoLinea {
  promo: Discount | null
  /** Cuánto se ahorra en toda la línea. */
  ahorro: number
}

/**
 * Promociones: qué aplica, cuánto ahorra y cómo se muestra.
 *
 * Reglas:
 *  - Una promoción automática aplica sola; con `code` es un cupón y solo entra
 *    si el cliente lo escribió.
 *  - En cada línea gana la promoción que más ahorra: no se acumulan, para que
 *    el precio que ve el cliente sea fácil de explicar.
 *  - Las ventas pasadas no se tocan: el pedido guarda el precio con que se vendió.
 */
export default class PromotionService {
  /**
   * ¿Corre hoy? Pausada, fuera del rango de fechas o en un día de la semana
   * que no toca → no. `hoy` se mide con la hora del país del negocio.
   */
  static vigente(p: Discount, ahora: DateTime<true> | DateTime<false> = DateTime.now()) {
    if (!p.isActive) return false
    const hoy = ahora.startOf('day')
    if (p.startDate && hoy < DateTime.fromISO(p.startDate.toISODate()!, { zone: ahora.zone }).startOf('day')) return false
    if (p.endDate && hoy > DateTime.fromISO(p.endDate.toISODate()!, { zone: ahora.zone }).endOf('day')) return false
    const dias = p.dias
    if (dias.length && !dias.includes(ahora.weekday)) return false
    return true
  }

  /** «viernes y sábado», «lunes, miércoles y viernes»; null si aplica todos los días. */
  static diasTexto(p: Discount) {
    const dias = p.dias
    if (!dias.length || dias.length === 7) return null
    const nombres = [...dias].sort((a, b) => a - b).map((d) => NOMBRES_DIA[d])
    return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
  }

  /** «Ahora» en la zona horaria del país del negocio. */
  static async ahoraDe(businessId: number) {
    const fila = await db.from('businesses').where('id', businessId).select('country').first()
    const zona = PAISES[(fila?.country as CodigoPais) ?? 'PE']?.zona ?? 'America/Lima'
    return DateTime.now().setZone(zona)
  }

  /** Promociones vigentes; con `cupon` suma la que lleve ese código. */
  static async activas(businessId: number, cupon?: string | null) {
    const todas = await Discount.query()
      .where('business_id', businessId)
      .andWhere('is_active', true)
      .preload('targets')
    const codigo = cupon?.trim().toLowerCase() || null
    const ahora = await this.ahoraDe(businessId)

    return todas.filter(
      (p) => this.vigente(p, ahora) && (!p.code || (codigo !== null && p.code.toLowerCase() === codigo))
    )
  }

  /** El cupón con ese código si existe y está vigente; null si no. */
  static async buscarCupon(businessId: number, codigo: string) {
    const c = codigo.trim().toLowerCase()
    if (!c) return null
    const promo = await Discount.query()
      .where('business_id', businessId)
      .whereRaw('lower(code) = ?', [c])
      .preload('targets')
      .first()
    return promo && this.vigente(promo, await this.ahoraDe(businessId)) ? promo : null
  }

  static async categoriasPorProducto(productIds: number[]) {
    const mapa = new Map<number, number[]>()
    if (!productIds.length) return mapa
    const filas = await CategoryProduct.query().whereIn('product_id', productIds)
    for (const f of filas) mapa.set(f.productId, [...(mapa.get(f.productId) ?? []), f.categoryId])
    return mapa
  }

  static aplicaA(p: Discount, productId: number, categoryIds: number[], variationId?: number) {
    if (p.scope === 'all') return true
    // Formato anterior (un solo producto o categoría).
    if (p.scope === 'product') return p.productId === productId
    if (p.scope === 'category') return p.categoryId !== null && categoryIds.includes(p.categoryId)

    return (p.targets ?? []).some((t) =>
      t.kind === 'product'
        ? t.targetId === productId
        : t.kind === 'category'
          ? categoryIds.includes(t.targetId)
          : variationId !== undefined && t.targetId === variationId
    )
  }

  static ahorroDe(p: Discount, precioUnit: number, cantidad: number) {
    if (p.kind === 'percent') {
      return PricingService.redondear(precioUnit * cantidad * (Number(p.value) / 100))
    }
    if (p.kind === 'fixed') {
      return PricingService.redondear(Math.min(Number(p.value), precioUnit) * cantidad)
    }
    const compra = Number(p.buyQty ?? 0)
    const paga = Number(p.payQty ?? 0)
    if (compra < 2 || paga < 1 || paga >= compra) return 0
    const gratis = Math.floor(cantidad / compra) * (compra - paga)
    return PricingService.redondear(precioUnit * gratis)
  }

  /** Mejor promoción para una línea del carrito (la que más ahorra). */
  static mejorParaLinea(promos: Discount[], l: LineaPromo): ResultadoLinea {
    let mejor: ResultadoLinea = { promo: null, ahorro: 0 }
    for (const p of promos) {
      if (!this.aplicaA(p, l.productId, l.categoryIds, l.variationId)) continue
      const ahorro = this.ahorroDe(p, l.precioUnit, l.cantidad)
      if (ahorro > mejor.ahorro) mejor = { promo: p, ahorro }
    }
    return mejor
  }

  /**
   * Precio de 1 unidad para mostrar en el catálogo: solo cuentan las
   * promociones por porcentaje o monto fijo. Las de «lleva N paga M» se
   * muestran como etiqueta, porque dependen de cuántas unidades se compren.
   */
  static precioPublico(
    promos: Discount[],
    productId: number,
    categoryIds: number[],
    precio: number,
    variationId?: number
  ) {
    const original = PricingService.redondear(precio)
    const l = this.mejorParaLinea(
      promos.filter((p) => !p.code && p.kind !== 'bundle'),
      { productId, variationId, categoryIds, precioUnit: original, cantidad: 1 }
    )
    const final = PricingService.redondear(Math.max(0, original - l.ahorro))

    return {
      original,
      final,
      descuento: original > 0 ? Math.round((l.ahorro / original) * 100) : 0,
      ahorro: l.ahorro,
      etiquetas: promos
        .filter((p) => !p.code && this.aplicaA(p, productId, categoryIds, variationId))
        .map((p) => ({ id: p.id, name: p.name, label: this.etiqueta(p) })),
    }
  }

  static etiqueta(p: Discount, simbolo = 'S/') {
    if (p.kind === 'percent') return `−${Number(p.value)}%`
    if (p.kind === 'fixed') return `${simbolo} ${Number(p.value).toFixed(2)} menos`
    return `${p.buyQty}x${p.payQty}`
  }

  /**
   * Cuánto se ahorraría un carrito, para que la tienda lo muestre antes de
   * pedir. Es solo informativo: el pedido vuelve a calcularlo en el servidor.
   * Cada ítem trae `variationId` (tienda) o `productId` (carta).
   */
  static async cotizar(
    business: Business,
    items: { variationId?: number; productId?: number; quantity: number; extras?: number }[],
    codigo?: string | null
  ) {
    const lineasEntrada = items
      .map((i) => ({ ...i, quantity: Math.floor(Number(i.quantity)) }))
      .filter((i) => i.quantity >= 1 && (i.variationId || i.productId))

    const variationIds = lineasEntrada.filter((i) => i.variationId).map((i) => Number(i.variationId))
    const variaciones = variationIds.length
      ? await ProductVariation.query().where('business_id', business.id).whereIn('id', variationIds)
      : []
    const porVariacion = new Map(variaciones.map((v) => [v.id, v]))

    const productIds = [
      ...new Set([
        ...lineasEntrada.filter((i) => i.productId).map((i) => Number(i.productId)),
        ...variaciones.map((v) => v.productId),
      ]),
    ]
    const productos = productIds.length
      ? await Product.query().where('business_id', business.id).whereIn('id', productIds)
      : []
    const porProducto = new Map(productos.map((p) => [p.id, p]))
    const categoriasDe = await this.categoriasPorProducto(productIds)

    const cupon = codigo?.trim() ? await this.buscarCupon(business.id, codigo) : null
    const promos = await this.activas(business.id, cupon ? codigo : null)

    // Mismas líneas repetidas se juntan, igual que al crear el pedido.
    // En la tienda las líneas repetidas se juntan; en la carta cada línea
    // (con sus opciones) cuenta aparte, igual que al crear el pedido.
    const juntas = new Map<
      string,
      { productId: number; variationId?: number; precioUnit: number; extras: number; cantidad: number }
    >()
    lineasEntrada.forEach((i, indice) => {
      const variacion = i.variationId ? porVariacion.get(Number(i.variationId)) : null
      const producto = porProducto.get(variacion ? variacion.productId : Number(i.productId))
      if (!producto) return
      const clave = variacion ? `v${variacion.id}` : `p${indice}`
      const previa = juntas.get(clave)
      juntas.set(clave, {
        productId: producto.id,
        variationId: variacion?.id,
        precioUnit: Number(variacion ? variacion.price : producto.price),
        extras: variacion ? 0 : Math.max(0, Number(i.extras ?? 0)),
        cantidad: (previa?.cantidad ?? 0) + i.quantity,
      })
    })

    let subtotal = 0
    let descuento = 0
    let cuponUsado = false
    const lineas = [...juntas.entries()].map(([clave, l]) => {
      const mejor = this.mejorParaLinea(promos, {
        productId: l.productId,
        variationId: l.variationId,
        categoryIds: categoriasDe.get(l.productId) ?? [],
        precioUnit: l.precioUnit,
        cantidad: l.cantidad,
      })
      descuento += mejor.ahorro
      subtotal += (l.precioUnit + l.extras) * l.cantidad
      if (cupon && mejor.promo?.id === cupon.id) cuponUsado = true
      return {
        clave,
        ahorro: mejor.ahorro,
        promo: mejor.promo ? { id: mejor.promo.id, name: mejor.promo.name, label: this.etiqueta(mejor.promo, business.currencySymbol) } : null,
      }
    })

    let estadoCupon: { codigo: string; valido: boolean; mensaje: string } | null = null
    if (codigo?.trim()) {
      estadoCupon = !cupon
        ? { codigo: codigo.trim().toUpperCase(), valido: false, mensaje: 'El cupón no es válido o ya venció' }
        : !cuponUsado
          ? { codigo: cupon.code!, valido: false, mensaje: 'Este cupón no aplica a los productos de tu carrito' }
          : { codigo: cupon.code!, valido: true, mensaje: `Cupón «${cupon.name}» aplicado` }
    }

    return {
      lineas,
      /** A precio de lista (sin promociones), con los extras de la carta. */
      subtotal: PricingService.redondear(subtotal),
      descuento: PricingService.redondear(descuento),
      cupon: estadoCupon,
    }
  }

  /** Nombres de los destinos de las promociones, para mostrarlos en la lista y en la tienda. */
  static async nombresDestinos(businessId: number, lista: Discount[]) {
    const ids = (kind: string) => [
      ...new Set(lista.flatMap((p) => p.targets.filter((t) => t.kind === kind).map((t) => t.targetId))),
    ]
    const productos = ids('product').length
      ? await Product.query().where('business_id', businessId).whereIn('id', ids('product')).select('id', 'name')
      : []
    const categorias = ids('category').length
      ? await Category.query().where('business_id', businessId).whereIn('id', ids('category')).select('id', 'name')
      : []
    const variaciones = ids('variation').length
      ? await ProductVariation.query()
          .where('business_id', businessId)
          .whereIn('id', ids('variation'))
          .preload('product', (q) => q.select('id', 'name'))
          .preload('attributes', (a) => a.preload('value'))
      : []

    const nombre = new Map<string, string>()
    for (const p of productos) nombre.set(`product:${p.id}`, p.name)
    for (const c of categorias) nombre.set(`category:${c.id}`, c.name)
    for (const v of variaciones) {
      const etiqueta = v.attributes.map((a) => a.value?.value).filter(Boolean).join(' · ')
      nombre.set(`variation:${v.id}`, `${v.product?.name ?? ''}${etiqueta ? ` — ${etiqueta}` : ''}`)
    }
    return nombre
  }

  static validar(d: {
    name?: string
    kind?: string
    value?: number
    buyQty?: number | null
    payQty?: number | null
    scope?: string
    productId?: number | null
    categoryId?: number | null
    targets?: { kind: string; id: number }[]
    weekdays?: number[]
    startDate?: string | null
    endDate?: string | null
  }) {
    if (!d.name || d.name.trim().length < 2) return 'Ponle un nombre a la promoción'
    if (!['percent', 'fixed', 'bundle'].includes(String(d.kind))) return 'El tipo debe ser porcentaje, monto fijo o llevar N pagar M'
    if (d.kind === 'percent' && !(Number(d.value) > 0 && Number(d.value) <= 100)) {
      return 'El porcentaje debe estar entre 1 y 100'
    }
    if (d.kind === 'fixed' && !(Number(d.value) > 0)) return 'El monto debe ser mayor a 0'
    if (d.kind === 'bundle') {
      const c = Number(d.buyQty)
      const p = Number(d.payQty)
      if (!Number.isInteger(c) || !Number.isInteger(p) || c < 2 || p < 1 || p >= c) {
        return 'En «lleva N paga M», N debe ser mayor que M (por ejemplo 2 y 1)'
      }
    }
    if (!['all', 'selection'].includes(String(d.scope))) return 'El alcance debe ser toda la tienda o una selección'
    if (d.scope === 'selection' && !d.targets?.length) {
      return 'Elige al menos un producto, variación o categoría'
    }
    if (d.weekdays?.some((n) => !Number.isInteger(n) || n < 1 || n > 7)) return 'Los días de la semana no son válidos'
    if (d.startDate && d.endDate && d.endDate < d.startDate) return 'La fecha de fin es anterior a la de inicio'
    return null
  }
}
