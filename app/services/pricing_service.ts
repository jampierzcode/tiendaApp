import type Discount from '#models/discount'
import { DateTime } from 'luxon'

export interface PrecioCalculado {
  /** Precio de lista, sin descuento. */
  original: number
  /** Lo que paga el cliente. */
  final: number
  /** Porcentaje aplicado, 0 si no hay descuento vigente. */
  descuento: number
  /** Cuánto se ahorra. */
  ahorro: number
}

/**
 * Aplica los descuentos vigentes al precio.
 *
 * La tabla `discounts` existía desde el principio pero nadie la usaba: el
 * precio que veía el cliente era siempre el de lista. Aquí es donde el
 * descuento por fin llega al bolsillo.
 */
export default class PricingService {
  /** El descuento vigente hoy, o el mayor si hay varios solapados. */
  static descuentoVigente(discounts: Discount[] = [], fecha = DateTime.now()): number {
    const hoy = fecha.startOf('day')

    const vigentes = discounts.filter((d) => {
      const inicio = d.startDate?.startOf('day')
      const fin = d.endDate?.endOf('day')
      if (!inicio || !fin) return false
      return hoy >= inicio && hoy <= fin
    })

    if (!vigentes.length) return 0

    // Si el negocio dejó dos promociones solapadas, gana la mejor para el
    // cliente: es lo que espera quien ve el cartel más llamativo.
    return Math.max(...vigentes.map((d) => Number(d.percentage)))
  }

  static calcular(precioBase: number, discounts: Discount[] = [], fecha?: DateTime): PrecioCalculado {
    const original = Number(precioBase)
    const descuento = this.descuentoVigente(discounts, fecha)
    const final = this.redondear(original * (1 - descuento / 100))

    return {
      original: this.redondear(original),
      final,
      descuento,
      ahorro: this.redondear(original - final),
    }
  }

  /** Céntimos exactos: evita los 39.900000000000006 de coma flotante. */
  static redondear(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100
  }
}
