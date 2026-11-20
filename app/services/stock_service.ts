import type Business from '#models/business'
import Ingredient from '#models/ingredient'
import IngredientService from '#services/ingredient_service'
import { OrderError } from '#services/order_service'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Rango de fechas de un reporte (por defecto, los últimos 30 días). */
function rango(desde?: string | null, hasta?: string | null) {
  const fin = hasta ? DateTime.fromISO(hasta).endOf('day') : DateTime.now().endOf('day')
  const inicio = desde
    ? DateTime.fromISO(desde).startOf('day')
    : fin.minus({ days: 29 }).startOf('day')
  if (!inicio.isValid || !fin.isValid) throw new OrderError('Fechas no válidas')
  return { inicio: inicio.toSQL()!, fin: fin.toSQL()! }
}

/**
 * Inventario del restaurante: compras, preparaciones, conteo físico,
 * kardex y reportes. Todo movimiento de stock pasa por
 * `IngredientService.aplicar`, que mantiene el saldo y el costo promedio.
 */
export default class StockService {
  // ------------------------------------------------------------ proveedores

  static async proveedores(business: Business) {
    return db
      .from('suppliers')
      .where('business_id', business.id)
      .andWhere('status', 'activo')
      .orderBy('name', 'asc')
      .select('id', 'name', 'ruc', 'phone', 'contact_name as contactName')
  }

  static async crearProveedor(
    business: Business,
    datos: { name: string; ruc?: string; phone?: string }
  ) {
    const name = String(datos.name ?? '')
      .trim()
      .slice(0, 150)
    if (!name) throw new OrderError('Escribe el nombre del proveedor')
    const [fila] = await db
      .table('suppliers')
      .insert({
        business_id: business.id,
        name,
        ruc:
          String(datos.ruc ?? '')
            .trim()
            .slice(0, 20) || null,
        phone:
          String(datos.phone ?? '')
            .trim()
            .slice(0, 20) || null,
        status: 'activo',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(['id', 'name'])
    return fila
  }

  // ---------------------------------------------------------------- compras

  static async compras(business: Business) {
    const filas = await db
      .from('ingredient_purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where('p.business_id', business.id)
      .orderBy('p.purchased_on', 'desc')
      .orderBy('p.id', 'desc')
      .limit(100)
      .select('p.*', 's.name as supplier_name')
    const ids = filas.map((f) => f.id)
    const lineas = ids.length
      ? await db
          .from('ingredient_purchase_lines as l')
          .join('ingredients as i', 'i.id', 'l.ingredient_id')
          .whereIn('l.purchase_id', ids)
          .select('l.*', 'i.name as ingredient_name', 'i.unit as ingredient_unit')
      : []
    return filas.map((f) => ({
      id: f.id,
      proveedor: f.supplier_name,
      supplierId: f.supplier_id,
      documento: f.document,
      fecha: DateTime.fromJSDate(f.purchased_on).toISODate(),
      total: Number(f.total),
      estado: f.status,
      nota: f.note,
      lineas: lineas
        .filter((l) => l.purchase_id === f.id)
        .map((l) => ({
          insumo: l.ingredient_name,
          cantidad: Number(l.quantity),
          unidad: l.unit_label,
          precio: Number(l.unit_price),
          total: Number(l.line_total),
          base: `${Number(l.base_quantity)} ${l.ingredient_unit}`,
        })),
    }))
  }

  /**
   * Registra una compra. Cada línea puede venir en unidad de compra (2 sacos)
   * o de uso (5 kg); se convierte con el factor del insumo, sube el stock y
   * recalcula el costo promedio por unidad de uso.
   */
  static async registrarCompra(
    business: Business,
    userId: number,
    datos: {
      supplierId?: number | null
      document?: string | null
      date?: string | null
      note?: string | null
      lines: {
        ingredientId: number
        quantity: number
        inPurchaseUnit?: boolean
        unitPrice: number
      }[]
    }
  ) {
    const lineas = (datos.lines ?? []).filter((l) => Number(l.quantity) > 0)
    if (!lineas.length) throw new OrderError('Agrega al menos un insumo con cantidad')
    const fecha = datos.date ? DateTime.fromISO(datos.date) : DateTime.now()
    if (!fecha.isValid) throw new OrderError('Fecha no válida')

    return db.transaction(async (trx) => {
      if (datos.supplierId) {
        const s = await trx
          .from('suppliers')
          .where('business_id', business.id)
          .andWhere('id', datos.supplierId)
          .first()
        if (!s) throw new OrderError('Proveedor no válido')
      }
      const [compra] = await trx
        .table('ingredient_purchases')
        .insert({
          business_id: business.id,
          supplier_id: datos.supplierId || null,
          document:
            String(datos.document ?? '')
              .trim()
              .slice(0, 40) || null,
          purchased_on: fecha.toISODate(),
          note:
            String(datos.note ?? '')
              .trim()
              .slice(0, 255) || null,
          status: 'registrada',
          user_id: userId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
      const compraId = typeof compra === 'object' ? compra.id : compra

      let total = 0
      for (const l of lineas) {
        const insumo = await Ingredient.query({ client: trx })
          .where('business_id', business.id)
          .andWhere('id', Number(l.ingredientId))
          .first()
        if (!insumo) throw new OrderError('Un insumo de la compra no existe')
        const enCompra = Boolean(l.inPurchaseUnit && insumo.purchaseUnit)
        const factor = enCompra ? Number(insumo.purchaseFactor) || 1 : 1
        const cantidad = Number(l.quantity)
        const precio = Number(l.unitPrice) || 0
        const totalLinea = r2(cantidad * precio)
        const base = r3(cantidad * factor)
        total += totalLinea
        await trx.table('ingredient_purchase_lines').insert({
          purchase_id: compraId,
          ingredient_id: insumo.id,
          quantity: cantidad,
          unit_label: enCompra ? insumo.purchaseUnit : insumo.unit,
          factor,
          unit_price: precio,
          line_total: totalLinea,
          base_quantity: base,
        })
        await IngredientService.aplicar({
          businessId: business.id,
          ingredientId: insumo.id,
          type: 'compra',
          quantity: base,
          unitCost: base > 0 ? totalLinea / base : null,
          referenceType: 'ingredient_purchase',
          referenceId: compraId,
          note: datos.document ? `Compra ${datos.document}` : 'Compra',
          userId,
          trx,
        })
      }
      await trx
        .from('ingredient_purchases')
        .where('id', compraId)
        .update({ total: r2(total) })
      return { id: compraId, total: r2(total) }
    })
  }

  /** Anula una compra: saca del stock lo que había entrado. */
  static async anularCompra(business: Business, userId: number, id: number) {
    return db.transaction(async (trx) => {
      const compra = await trx
        .from('ingredient_purchases')
        .where('business_id', business.id)
        .andWhere('id', id)
        .forUpdate()
        .first()
      if (!compra) throw new OrderError('Compra no encontrada')
      if (compra.status === 'anulada') throw new OrderError('Esa compra ya está anulada')
      const lineas = await trx.from('ingredient_purchase_lines').where('purchase_id', id)
      for (const l of lineas) {
        await IngredientService.aplicar({
          businessId: business.id,
          ingredientId: l.ingredient_id,
          // Compra en negativo: es corregir una entrada, no una pérdida.
          type: 'compra',
          quantity: -Number(l.base_quantity),
          referenceType: 'ingredient_purchase',
          referenceId: id,
          note: `Anulación de compra ${compra.document ?? `#${id}`}`,
          userId,
          trx,
        })
      }
      await trx
        .from('ingredient_purchases')
        .where('id', id)
        .update({ status: 'anulada', updated_at: new Date() })
      return { ok: true }
    })
  }

  // ---------------------------------------------------------- preparaciones

  static async componentes(business: Business, ingredientId: number) {
    const filas = await db
      .from('ingredient_components as c')
      .join('ingredients as i', 'i.id', 'c.component_id')
      .where('c.business_id', business.id)
      .andWhere('c.ingredient_id', ingredientId)
      .select(
        'c.component_id as ingredientId',
        'c.quantity',
        'i.name',
        'i.unit',
        'i.avg_cost as avgCost'
      )
    return filas.map((f) => ({ ...f, quantity: Number(f.quantity), avgCost: Number(f.avgCost) }))
  }

  /** Guarda qué lleva una preparación por tanda (y cuánto rinde). */
  static async guardarComponentes(
    business: Business,
    ingredientId: number,
    datos: { yieldQty: number; components: { ingredientId: number; quantity: number }[] }
  ) {
    const prep = await Ingredient.query()
      .where('business_id', business.id)
      .andWhere('id', ingredientId)
      .firstOrFail()
    if (!(Number(datos.yieldQty) > 0)) throw new OrderError('Indica cuánto rinde una tanda')
    const lineas = (datos.components ?? []).filter(
      (c) => Number(c.quantity) > 0 && Number(c.ingredientId) !== prep.id
    )
    if (!lineas.length) throw new OrderError('Agrega lo que lleva la preparación')
    await db.transaction(async (trx) => {
      const validos = await trx
        .from('ingredients')
        .where('business_id', business.id)
        .whereIn(
          'id',
          lineas.map((l) => Number(l.ingredientId))
        )
        .select('id')
      if (validos.length !== new Set(lineas.map((l) => Number(l.ingredientId))).size) {
        throw new OrderError('Un insumo de la preparación no existe')
      }
      await trx.from('ingredient_components').where('ingredient_id', prep.id).delete()
      for (const l of lineas) {
        await trx.table('ingredient_components').insert({
          business_id: business.id,
          ingredient_id: prep.id,
          component_id: Number(l.ingredientId),
          quantity: Number(l.quantity),
          created_at: new Date(),
        })
      }
      await trx
        .from('ingredients')
        .where('id', prep.id)
        .update({ kind: 'preparacion', yield_qty: Number(datos.yieldQty) })
    })
    return { ok: true }
  }

  /**
   * Produce tandas de una preparación: descuenta sus componentes y suma lo
   * que rinde, con el costo real de lo que se usó.
   */
  static async producir(business: Business, userId: number, ingredientId: number, tandas: number) {
    const n = Number(tandas)
    if (!(n > 0)) throw new OrderError('Indica cuántas tandas se hicieron')
    return db.transaction(async (trx) => {
      const prep = await Ingredient.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('id', ingredientId)
        .firstOrFail()
      const rinde = Number(prep.yieldQty ?? 0)
      if (prep.kind !== 'preparacion' || rinde <= 0)
        throw new OrderError('Primero arma la receta de la preparación')
      const comps = await trx.from('ingredient_components').where('ingredient_id', prep.id)
      if (!comps.length) throw new OrderError('La preparación no tiene componentes')

      let costo = 0
      for (const c of comps) {
        const usado = r3(Number(c.quantity) * n)
        const ins = await trx
          .from('ingredients')
          .where('id', c.component_id)
          .select('avg_cost')
          .first()
        costo += usado * Number(ins?.avg_cost ?? 0)
        await IngredientService.aplicar({
          businessId: business.id,
          ingredientId: c.component_id,
          type: 'produccion',
          quantity: -usado,
          referenceType: 'produccion',
          referenceId: prep.id,
          note: `Usado en ${prep.name} (${n} tanda${n === 1 ? '' : 's'})`,
          userId,
          trx,
        })
      }
      const sale = r3(rinde * n)
      await IngredientService.aplicar({
        businessId: business.id,
        ingredientId: prep.id,
        type: 'produccion',
        quantity: sale,
        unitCost: sale > 0 ? costo / sale : null,
        referenceType: 'produccion',
        referenceId: prep.id,
        note: `Producción: ${n} tanda${n === 1 ? '' : 's'}`,
        userId,
        trx,
      })
      return { producido: sale, costo: r2(costo) }
    })
  }

  // ----------------------------------------------------------------- conteo

  static async conteos(business: Business) {
    const filas = await db
      .from('inventory_counts')
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .limit(50)
    return filas.map((c) => ({
      id: c.id,
      estado: c.status,
      categoria: c.category,
      nota: c.note,
      creado: c.created_at,
      cerrado: c.closed_at,
      diferencia: c.difference_value === null ? null : Number(c.difference_value),
    }))
  }

  /** Abre un conteo con todos los insumos activos (o solo de una categoría). */
  static async abrirConteo(
    business: Business,
    userId: number,
    datos: { category?: string | null; note?: string | null }
  ) {
    const abierto = await db
      .from('inventory_counts')
      .where('business_id', business.id)
      .andWhere('status', 'borrador')
      .first()
    if (abierto) throw new OrderError('Ya hay un conteo en curso: termínalo o descártalo')
    return db.transaction(async (trx) => {
      const [fila] = await trx
        .table('inventory_counts')
        .insert({
          business_id: business.id,
          status: 'borrador',
          category: String(datos.category ?? '').trim() || null,
          note:
            String(datos.note ?? '')
              .trim()
              .slice(0, 255) || null,
          user_id: userId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
      const id = typeof fila === 'object' ? fila.id : fila
      const q = trx
        .from('ingredients')
        .where('business_id', business.id)
        .andWhere('is_active', true)
        .select('id')
      if (datos.category?.trim()) q.andWhere('category', datos.category.trim())
      const insumos = await q
      if (!insumos.length) throw new OrderError('No hay insumos que contar')
      await trx
        .table('inventory_count_lines')
        .multiInsert(insumos.map((i) => ({ count_id: id, ingredient_id: i.id })))
      return { id }
    })
  }

  static async conteo(business: Business, id: number) {
    const c = await db
      .from('inventory_counts')
      .where('business_id', business.id)
      .andWhere('id', id)
      .first()
    if (!c) throw new OrderError('Conteo no encontrado')
    const lineas = await db
      .from('inventory_count_lines as l')
      .join('ingredients as i', 'i.id', 'l.ingredient_id')
      .where('l.count_id', id)
      .orderBy('i.category', 'asc')
      .orderBy('i.name', 'asc')
      .select('l.*', 'i.name', 'i.unit', 'i.category', 'i.stock', 'i.avg_cost')
    return {
      id: c.id,
      estado: c.status,
      categoria: c.category,
      nota: c.note,
      creado: c.created_at,
      cerrado: c.closed_at,
      diferencia: c.difference_value === null ? null : Number(c.difference_value),
      lineas: lineas.map((l) => ({
        ingredientId: l.ingredient_id,
        nombre: l.name,
        unidad: l.unit,
        categoria: l.category,
        // En borrador el "esperado" es el stock de este momento (puede seguir moviéndose con ventas).
        esperado: c.status === 'cerrado' ? Number(l.expected) : Number(l.stock),
        contado: l.counted === null ? null : Number(l.counted),
        diferencia: l.difference === null ? null : Number(l.difference),
        costo: Number(l.unit_cost ?? l.avg_cost ?? 0),
      })),
    }
  }

  /** Guarda lo contado (se puede ir llenando de a pocos). */
  static async guardarConteo(
    business: Business,
    id: number,
    valores: Record<string, number | null>
  ) {
    const c = await db
      .from('inventory_counts')
      .where('business_id', business.id)
      .andWhere('id', id)
      .first()
    if (!c) throw new OrderError('Conteo no encontrado')
    if (c.status !== 'borrador') throw new OrderError('El conteo ya está cerrado')
    for (const [ingredientId, v] of Object.entries(valores ?? {})) {
      const counted = v === null || v === undefined || (v as unknown) === '' ? null : Number(v)
      if (counted !== null && (!Number.isFinite(counted) || counted < 0))
        throw new OrderError('Cantidad no válida')
      await db
        .from('inventory_count_lines')
        .where('count_id', id)
        .andWhere('ingredient_id', Number(ingredientId))
        .update({ counted })
    }
    await db.from('inventory_counts').where('id', id).update({ updated_at: new Date() })
    return { ok: true }
  }

  /**
   * Cierra el conteo: compara lo contado con el stock de ese momento y
   * ajusta la diferencia (faltante o sobrante) con su costo. Lo que no se
   * contó no se toca.
   */
  static async cerrarConteo(business: Business, userId: number, id: number) {
    return db.transaction(async (trx) => {
      const c = await trx
        .from('inventory_counts')
        .where('business_id', business.id)
        .andWhere('id', id)
        .forUpdate()
        .first()
      if (!c) throw new OrderError('Conteo no encontrado')
      if (c.status !== 'borrador') throw new OrderError('El conteo ya está cerrado')
      const lineas = await trx
        .from('inventory_count_lines')
        .where('count_id', id)
        .whereNotNull('counted')
      if (!lineas.length) throw new OrderError('Todavía no contaste nada')
      let valor = 0
      for (const l of lineas) {
        const ins = await Ingredient.query({ client: trx })
          .where('id', l.ingredient_id)
          .forUpdate()
          .firstOrFail()
        const esperado = Number(ins.stock)
        const diferencia = r3(Number(l.counted) - esperado)
        const costo = Number(ins.avgCost)
        valor += diferencia * costo
        await trx
          .from('inventory_count_lines')
          .where('id', l.id)
          .update({ expected: esperado, difference: diferencia, unit_cost: costo })
        if (Math.abs(diferencia) > 0.0005) {
          await IngredientService.aplicar({
            businessId: business.id,
            ingredientId: ins.id,
            type: 'conteo',
            quantity: diferencia,
            referenceType: 'inventory_count',
            referenceId: id,
            note: diferencia < 0 ? 'Faltante en conteo físico' : 'Sobrante en conteo físico',
            userId,
            trx,
          })
        }
      }
      await trx
        .from('inventory_counts')
        .where('id', id)
        .update({
          status: 'cerrado',
          closed_at: new Date(),
          closed_by_user_id: userId,
          difference_value: r2(valor),
          updated_at: new Date(),
        })
      return { diferencia: r2(valor) }
    })
  }

  static async descartarConteo(business: Business, id: number) {
    const n = await db
      .from('inventory_counts')
      .where('business_id', business.id)
      .andWhere('id', id)
      .andWhere('status', 'borrador')
      .delete()
    if (!n) throw new OrderError('Solo se descarta un conteo en curso')
    return { ok: true }
  }

  // ------------------------------------------------------------- movimientos

  static async movimientos(
    business: Business,
    filtros: { ingredientId?: number; type?: string; desde?: string; hasta?: string }
  ) {
    const { inicio, fin } = rango(filtros.desde, filtros.hasta)
    const q = db
      .from('ingredient_movements as m')
      .join('ingredients as i', 'i.id', 'm.ingredient_id')
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .where('m.business_id', business.id)
      .andWhereBetween('m.created_at', [inicio, fin])
      .orderBy('m.id', 'desc')
      .limit(500)
      .select('m.*', 'i.name as ingredient_name', 'i.unit', 'u.name as user_name')
    if (filtros.ingredientId) q.andWhere('m.ingredient_id', filtros.ingredientId)
    if (filtros.type) q.andWhere('m.type', filtros.type)
    const filas = await q
    return filas.map((m) => ({
      id: m.id,
      fecha: m.created_at,
      insumo: m.ingredient_name,
      unidad: m.unit,
      tipo: m.type,
      cantidad: Number(m.quantity),
      saldo: Number(m.stock_after),
      costo: m.unit_cost === null ? null : Number(m.unit_cost),
      nota: m.note,
      usuario: m.user_name,
    }))
  }

  // ---------------------------------------------------------------- reportes

  /**
   * Reportes del periodo:
   *  - valorizado: lo que vale hoy el almacén, por categoría;
   *  - consumo: lo que se gastó por insumo (teórico por recetas) y lo que se
   *    perdió (mermas y faltantes de conteo), con su costo;
   *  - costo de ventas: ventas cobradas vs costo teórico de lo vendido;
   *  - platos: costo por receta, precio y margen de cada plato.
   */
  static async reportes(business: Business, desde?: string, hasta?: string) {
    const { inicio, fin } = rango(desde, hasta)

    const insumos = await db
      .from('ingredients')
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .select('id', 'name', 'unit', 'category', 'stock', 'min_stock', 'avg_cost')
    const porCategoria = new Map<string, number>()
    let valorTotal = 0
    for (const i of insumos) {
      const v = Math.max(Number(i.stock), 0) * Number(i.avg_cost)
      valorTotal += v
      const k = i.category || 'Sin categoría'
      porCategoria.set(k, (porCategoria.get(k) ?? 0) + v)
    }

    const movs = await db
      .from('ingredient_movements')
      .where('business_id', business.id)
      .andWhereBetween('created_at', [inicio, fin])
      .whereIn('type', ['consumo', 'devolucion', 'merma', 'conteo', 'ajuste'])
      .select('ingredient_id', 'type', 'quantity', 'unit_cost')
    const costoDe = new Map(insumos.map((i) => [i.id, Number(i.avg_cost)]))
    const consumo = new Map<number, { teorico: number; perdida: number }>()
    for (const m of movs) {
      const c = consumo.get(m.ingredient_id) ?? { teorico: 0, perdida: 0 }
      const q = Number(m.quantity)
      if (m.type === 'consumo') c.teorico += -q
      else if (m.type === 'devolucion') c.teorico -= q
      else if (q < 0) c.perdida += -q // merma, faltante de conteo o ajuste a la baja
      consumo.set(m.ingredient_id, c)
    }
    const filasConsumo = insumos
      .filter((i) => consumo.has(i.id))
      .map((i) => {
        const c = consumo.get(i.id)!
        const costo = costoDe.get(i.id) ?? 0
        return {
          insumo: i.name,
          unidad: i.unit,
          teorico: r3(c.teorico),
          perdida: r3(c.perdida),
          real: r3(c.teorico + c.perdida),
          costoTeorico: r2(c.teorico * costo),
          costoPerdida: r2(c.perdida * costo),
          perdidaPct: c.teorico > 0 ? r2((c.perdida / c.teorico) * 100) : null,
        }
      })
      .sort((a, b) => b.costoTeorico + b.costoPerdida - (a.costoTeorico + a.costoPerdida))

    const ventas = await db
      .from('orders')
      .where('business_id', business.id)
      .whereNotIn('status', ['cancelado', 'devuelto'])
      .whereNotNull('stock_committed_at')
      .andWhereBetween('stock_committed_at', [inicio, fin])
      .select(
        db.raw('COALESCE(SUM(total - shipping_cost), 0) as ventas'),
        db.raw('COUNT(*) as pedidos')
      )
      .first()
    const costoTeorico = filasConsumo.reduce((t, f) => t + f.costoTeorico, 0)
    const costoPerdidas = filasConsumo.reduce((t, f) => t + f.costoPerdida, 0)
    const totalVentas = Number(ventas?.ventas ?? 0)

    // Costo por plato con los costos promedio de hoy.
    const recetas = await db
      .from('recipes as r')
      .join('products as p', 'p.id', 'r.product_id')
      .where('r.business_id', business.id)
      .andWhere('p.status', 'activo')
      .select('r.id', 'p.id as product_id', 'p.name', 'p.price')
    const lineas = recetas.length
      ? await db
          .from('recipe_lines as l')
          .join('ingredients as i', 'i.id', 'l.ingredient_id')
          .whereIn(
            'l.recipe_id',
            recetas.map((r) => r.id)
          )
          .select('l.recipe_id', 'l.quantity', 'l.waste_percent', 'i.avg_cost')
      : []
    const platos = recetas
      .map((r) => {
        const costo = lineas
          .filter((l) => l.recipe_id === r.id)
          .reduce(
            (t, l) =>
              t + Number(l.quantity) * (1 + Number(l.waste_percent) / 100) * Number(l.avg_cost),
            0
          )
        const precio = Number(r.price)
        return {
          productId: r.product_id,
          plato: r.name,
          precio,
          costo: r2(costo),
          margen: r2(precio - costo),
          margenPct: precio > 0 ? r2(((precio - costo) / precio) * 100) : null,
          costoPct: precio > 0 ? r2((costo / precio) * 100) : null,
        }
      })
      .sort((a, b) => (b.costoPct ?? 0) - (a.costoPct ?? 0))

    return {
      valorizado: {
        total: r2(valorTotal),
        categorias: [...porCategoria.entries()].map(([categoria, valor]) => ({
          categoria,
          valor: r2(valor),
        })),
      },
      bajoStock: insumos
        .filter((i) => Number(i.stock) <= Number(i.min_stock))
        .map((i) => ({
          insumo: i.name,
          unidad: i.unit,
          stock: Number(i.stock),
          minimo: Number(i.min_stock),
        })),
      consumo: filasConsumo,
      costoVentas: {
        ventas: r2(totalVentas),
        pedidos: Number(ventas?.pedidos ?? 0),
        costoTeorico: r2(costoTeorico),
        costoPerdidas: r2(costoPerdidas),
        costoPct: totalVentas > 0 ? r2((costoTeorico / totalVentas) * 100) : null,
        costoRealPct:
          totalVentas > 0 ? r2(((costoTeorico + costoPerdidas) / totalVentas) * 100) : null,
      },
      platos,
    }
  }
}
