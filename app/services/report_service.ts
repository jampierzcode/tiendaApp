import env from '#start/env'
import db from '@adonisjs/lucid/services/db'

/**
 * Zona horaria en la que se agrupan los reportes.
 *
 * Las fechas se guardan como instante absoluto (`timestamptz`). Una venta de
 * las 8pm en Lima es la 1am del día siguiente en UTC: si se agrupara sin
 * convertir, las ventas de la tarde caerían en el día equivocado y el dueño
 * vería su mejor día de ventas partido en dos.
 */
export const ZONA_REPORTES = env.get('REPORTS_TIMEZONE', 'America/Lima')
const ZONA = ZONA_REPORTES

/** Estados que no cuentan como venta. */
const NO_VENDIDOS = ['cancelado', 'devuelto']

export type Granularidad = 'day' | 'week' | 'month'

export interface PuntoSerie {
  periodo: string
  vendido: number
  devuelto: number
  neto: number
  margen: number
  pedidos: number
}

interface Rango {
  desde: string
  hasta: string
}

export default class ReportService {
  /** `created_at` llevado a hora local y truncado al periodo pedido. */
  private static periodo(columna: string, granularidad: Granularidad) {
    return db.raw(`date_trunc(?, ${columna} AT TIME ZONE ?) as periodo`, [granularidad, ZONA])
  }

  /** Filtra por rango usando la hora local, no la del servidor. */
  private static enRango(query: any, columna: string, rango: Rango) {
    return query
      .whereRaw(`(${columna} AT TIME ZONE ?)::date >= ?::date`, [ZONA, rango.desde])
      .whereRaw(`(${columna} AT TIME ZONE ?)::date <= ?::date`, [ZONA, rango.hasta])
  }

  /**
   * Cifras de cabecera: vendido, devuelto, neto, margen y ticket promedio.
   *
   * El margen sale de `order_items.unit_cost`, que guarda el costo al momento
   * de la venta. Por eso importa que las compras actualicen el costo del
   * producto: si no, el margen sería inventado.
   */
  static async resumen(businessId: number, rango: Rango) {
    const ventas = await this.enRango(
      db
        .from('orders as o')
        .join('order_items as oi', 'oi.order_id', 'o.id')
        .where('o.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'o.created_at',
      rango
    )
      .select(
        db.raw('COALESCE(SUM(oi.line_total), 0) as vendido'),
        db.raw('COALESCE(SUM(oi.unit_cost * oi.quantity), 0) as costo'),
        db.raw('COALESCE(SUM(oi.quantity), 0) as unidades'),
        db.raw('COUNT(DISTINCT o.id) as pedidos')
      )
      .first()

      // Solo restan las devoluciones de pedidos que SIGUEN contando como
      // venta. Si el pedido quedó en estado devuelto ya está fuera del lado
      // de las ventas: restarlo otra vez lo descontaría dos veces.
    const devoluciones = await this.enRango(
      db
        .from('returns as r')
        .join('return_items as ri', 'ri.return_id', 'r.id')
        .join('orders as o', 'o.id', 'r.order_id')
        .where('r.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'r.created_at',
      rango
    )
      .select(
        db.raw('COALESCE(SUM(ri.line_total), 0) as devuelto'),
        db.raw('COALESCE(SUM(ri.quantity), 0) as unidades')
      )
      .first()

    const envios = await this.enRango(
      db
        .from('orders')
        .where('business_id', businessId)
        .whereNotIn('status', NO_VENDIDOS),
      'created_at',
      rango
    )
      .sum('shipping_cost as total')
      .first()

    const vendido = Number(ventas?.vendido ?? 0)
    const costo = Number(ventas?.costo ?? 0)
    const devuelto = Number(devoluciones?.devuelto ?? 0)
    const pedidos = Number(ventas?.pedidos ?? 0)
    const neto = this.redondear(vendido - devuelto)
    const margen = this.redondear(neto - costo)

    return {
      vendido: this.redondear(vendido),
      devuelto: this.redondear(devuelto),
      neto,
      costo: this.redondear(costo),
      margen,
      // Sobre el neto: es lo que quedó realmente vendido.
      margenPorcentaje: neto > 0 ? this.redondear((margen / neto) * 100) : 0,
      pedidos,
      unidades: Number(ventas?.unidades ?? 0) - Number(devoluciones?.unidades ?? 0),
      envios: this.redondear(Number(envios?.total ?? 0)),
      ticketPromedio: pedidos > 0 ? this.redondear(neto / pedidos) : 0,
    }
  }

  /** Serie temporal de ventas netas. */
  static async serieVentas(
    businessId: number,
    rango: Rango,
    granularidad: Granularidad
  ): Promise<PuntoSerie[]> {
    const ventas = await this.enRango(
      db
        .from('orders as o')
        .join('order_items as oi', 'oi.order_id', 'o.id')
        .where('o.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'o.created_at',
      rango
    )
      .select(
        this.periodo('o.created_at', granularidad),
        db.raw('COALESCE(SUM(oi.line_total), 0) as vendido'),
        db.raw('COALESCE(SUM(oi.unit_cost * oi.quantity), 0) as costo'),
        db.raw('COUNT(DISTINCT o.id) as pedidos')
      )
      .groupBy('periodo')
      .orderBy('periodo', 'asc')

    const devoluciones = await this.enRango(
      db
        .from('returns as r')
        .join('return_items as ri', 'ri.return_id', 'r.id')
        .join('orders as o', 'o.id', 'r.order_id')
        .where('r.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'r.created_at',
      rango
    )
      .select(
        this.periodo('r.created_at', granularidad),
        db.raw('COALESCE(SUM(ri.line_total), 0) as devuelto')
      )
      .groupBy('periodo')

    const devueltoPorPeriodo = new Map<string, number>(
      devoluciones.map((d: any) => [
        new Date(d.periodo).toISOString().slice(0, 10) as string,
        Number(d.devuelto),
      ])
    )

    return ventas.map((v: any) => {
      const clave = new Date(v.periodo).toISOString().slice(0, 10)
      const vendido = Number(v.vendido)
      const devuelto = devueltoPorPeriodo.get(clave) ?? 0
      const neto = this.redondear(vendido - devuelto)

      return {
        periodo: clave,
        vendido: this.redondear(vendido),
        devuelto: this.redondear(devuelto),
        neto,
        margen: this.redondear(neto - Number(v.costo)),
        pedidos: Number(v.pedidos),
      }
    })
  }

  /** Los que más se venden, ya descontadas las devoluciones. */
  static async productosTop(businessId: number, rango: Rango, limite = 10) {
    const vendidos = await this.enRango(
      db
        .from('orders as o')
        .join('order_items as oi', 'oi.order_id', 'o.id')
        .where('o.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'o.created_at',
      rango
    )
      .groupBy('oi.product_id', 'oi.product_name')
      .select(
        'oi.product_id',
        'oi.product_name',
        db.raw('SUM(oi.quantity) as unidades'),
        db.raw('SUM(oi.line_total) as ingresos'),
        db.raw('SUM(oi.unit_cost * oi.quantity) as costo')
      )
      .orderByRaw('SUM(oi.quantity) DESC')
      .limit(limite)

    const devueltos = await this.enRango(
      db
        .from('returns as r')
        .join('return_items as ri', 'ri.return_id', 'r.id')
        .join('order_items as oi', 'oi.id', 'ri.order_item_id')
        .join('orders as o', 'o.id', 'r.order_id')
        .where('r.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'r.created_at',
      rango
    )
      .groupBy('oi.product_id')
      .select('oi.product_id', db.raw('SUM(ri.quantity) as unidades'), db.raw('SUM(ri.line_total) as monto'))

    const porProducto = new Map<number, { unidades: number; monto: number }>(
      devueltos.map((d: any) => [
        Number(d.product_id),
        { unidades: Number(d.unidades), monto: Number(d.monto) },
      ])
    )

    return vendidos.map((v: any) => {
      const dev = porProducto.get(Number(v.product_id)) ?? { unidades: 0, monto: 0 }
      const unidades = Number(v.unidades) - dev.unidades
      const ingresos = this.redondear(Number(v.ingresos) - dev.monto)
      const margen = this.redondear(ingresos - Number(v.costo))

      return {
        productId: Number(v.product_id),
        nombre: v.product_name,
        unidades,
        devueltas: dev.unidades,
        ingresos,
        margen,
        margenPorcentaje: ingresos > 0 ? this.redondear((margen / ingresos) * 100) : 0,
      }
    })
  }

  /** Quién compra más. */
  static async clientesTop(businessId: number, rango: Rango, limite = 10) {
    const filas = await this.enRango(
      db
        .from('orders as o')
        .leftJoin('customers as c', 'c.id', 'o.customer_id')
        .where('o.business_id', businessId)
        .whereNotIn('o.status', NO_VENDIDOS),
      'o.created_at',
      rango
    )
      .groupBy('o.customer_id', 'c.name', 'c.phone')
      .select(
        'o.customer_id',
        db.raw('COALESCE(c.name, \'Cliente de mostrador\') as nombre'),
        'c.phone',
        db.raw('COUNT(*) as pedidos'),
        db.raw('SUM(o.total) as gastado')
      )
      .orderByRaw('SUM(o.total) DESC')
      .limit(limite)

    return filas.map((f: any) => ({
      customerId: f.customer_id ? Number(f.customer_id) : null,
      nombre: f.nombre,
      telefono: f.phone,
      pedidos: Number(f.pedidos),
      gastado: this.redondear(Number(f.gastado)),
    }))
  }

  /** Cómo cobra la tienda: alimenta el arqueo del día. */
  static async metodosPago(businessId: number, rango: Rango) {
    const filas = await this.enRango(
      db.from('payments').where('business_id', businessId),
      'paid_at',
      rango
    )
      .groupBy('method')
      .select('method', db.raw('SUM(amount) as total'), db.raw('COUNT(*) as cobros'))
      .orderByRaw('SUM(amount) DESC')

    return filas.map((f: any) => ({
      metodo: f.method,
      total: this.redondear(Number(f.total)),
      cobros: Number(f.cobros),
    }))
  }

  /** Pedidos abiertos por estado, para saber qué falta atender. */
  static async pedidosPorEstado(businessId: number, rango: Rango) {
    const filas = await this.enRango(
      db.from('orders').where('business_id', businessId),
      'created_at',
      rango
    )
      .groupBy('status')
      .select('status', db.raw('COUNT(*) as total'), db.raw('SUM(total) as monto'))

    return filas.map((f: any) => ({
      estado: f.status,
      pedidos: Number(f.total),
      monto: this.redondear(Number(f.monto)),
    }))
  }

  private static redondear(v: number) {
    return Math.round((Number(v) + Number.EPSILON) * 100) / 100
  }
}
