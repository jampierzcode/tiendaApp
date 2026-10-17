/** Precios y redondeos de dinero. Las promociones viven en PromotionService. */
export default class PricingService {
  /**
   * Precio sugerido para un costo nuevo. Mantiene el margen que ya tenía el
   * producto (sobre el precio); si no hay dato, usa 40 %. Sube al múltiplo de
   * S/ 0.10 para no sugerir precios con céntimos raros. Solo sugiere.
   */
  static sugerirPrecio(costoNuevo: number, precioActual: number, costoAnterior?: number | null) {
    let margen = 0.4
    if (precioActual > 0 && costoAnterior && costoAnterior > 0 && costoAnterior < precioActual) {
      margen = Math.min(0.9, Math.max(0.05, (precioActual - costoAnterior) / precioActual))
    }
    const bruto = costoNuevo / (1 - margen)
    return { precio: Math.ceil(bruto * 10 - 1e-9) / 10, margen: Math.round(margen * 1000) / 10 }
  }

  /** Céntimos exactos: evita los 39.900000000000006 de coma flotante. */
  static redondear(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100
  }
}
