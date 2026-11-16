import type Business from '#models/business'
import BusinessImage from '#models/business_image'

export type TipoMetodo = 'billetera' | 'transferencia' | 'efectivo' | 'tarjeta' | 'otro'

export interface ImagenMetodo {
  imageId: number
  url: string
  /** Cuándo la manda el vendedor IA. */
  cuando: 'al_confirmar' | 'si_lo_pide'
}

export interface MetodoPagoTienda {
  id: string
  nombre: string
  tipo: TipoMetodo
  numero: string
  cci: string
  titular: string
  instrucciones: string
  activo: boolean
  imagenes: ImagenMetodo[]
}

const MAX_METODOS = 15
const MAX_IMAGENES = 5

const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const TIPOS: TipoMetodo[] = ['billetera', 'transferencia', 'efectivo', 'tarjeta', 'otro']

/**
 * Métodos de pago de la tienda, al estilo yavendió!: cada uno con su número o
 * cuenta, titular, instrucciones y hasta 5 imágenes (QR) en total.
 */
export default class PaymentMethodService {
  static todos(business: Business): MetodoPagoTienda[] {
    try {
      const crudo = business.paymentMethods ? JSON.parse(business.paymentMethods) : []
      return Array.isArray(crudo) ? crudo : []
    } catch {
      return []
    }
  }

  static activos(business: Business) {
    return this.todos(business).filter((m) => m.activo)
  }

  /** Limpia lo que llega del panel; las imágenes deben ser de la galería de la tienda. */
  static async limpiar(business: Business, crudo: unknown): Promise<MetodoPagoTienda[]> {
    const lista = (Array.isArray(crudo) ? crudo : []).slice(0, MAX_METODOS)
    const ids = lista.flatMap((m: any) =>
      (Array.isArray(m?.imagenes) ? m.imagenes : []).map((i: any) => Number(i?.imageId))
    )
    const validas = ids.length
      ? await BusinessImage.query().where('business_id', business.id).whereIn('id', ids)
      : []
    const porId = new Map(validas.map((i) => [i.id, i]))
    let imagenes = 0

    return lista
      .map((m: any) => ({
        id: texto(m?.id, 40) || Math.random().toString(36).slice(2, 10),
        nombre: texto(m?.nombre, 60),
        tipo: TIPOS.includes(m?.tipo) ? m.tipo : 'otro',
        numero: texto(m?.numero, 60),
        cci: texto(m?.cci, 40),
        titular: texto(m?.titular, 120),
        instrucciones: texto(m?.instrucciones, 800),
        activo: m?.activo !== false,
        imagenes: (Array.isArray(m?.imagenes) ? m.imagenes : [])
          .map((i: any) => {
            const img = porId.get(Number(i?.imageId))
            if (!img || imagenes >= MAX_IMAGENES) return null
            imagenes++
            return {
              imageId: img.id,
              // Relativa en la base (como en business_images); absoluta al servirla.
              url: img.url.replace(/^https?:\/\/[^/]+(?=\/media\/)/, ''),
              cuando: i?.cuando === 'si_lo_pide' ? 'si_lo_pide' : 'al_confirmar',
            }
          })
          .filter(Boolean) as ImagenMetodo[],
      }))
      .filter((m) => m.nombre)
  }

  /**
   * Lo que ve el cliente como «cómo pagar» (carta, carrito, seguimiento):
   * si hay métodos activos se arma con ellos; si no, el texto libre antiguo.
   */
  static textoParaCliente(business: Business): string | null {
    const activos = this.activos(business)
    if (!activos.length) return business.paymentInstructions?.trim() || null
    return activos
      .map((m) =>
        [
          m.nombre,
          [m.numero, m.cci && `CCI ${m.cci}`].filter(Boolean).join(' · '),
          m.titular && `(${m.titular})`,
        ]
          .filter(Boolean)
          .join(' ')
      )
      .join('\n')
  }

  /** Texto libre antiguo, solo si no hay métodos activos (si los hay, manda la lista). */
  static textoLibre(business: Business) {
    return this.activos(business).length ? null : business.paymentInstructions?.trim() || null
  }

  /** Para el prompt del vendedor. */
  static texto(business: Business) {
    return this.activos(business)
      .map((m) =>
        [
          `- ${m.nombre}${m.id ? ` [metodoId: ${m.id}]` : ''}`,
          m.numero && `${m.tipo === 'transferencia' ? 'Cuenta' : 'Número'}: ${m.numero}`,
          m.cci && `CCI: ${m.cci}`,
          m.titular && `Titular: ${m.titular}`,
          m.instrucciones && `Indicaciones: ${m.instrucciones}`,
          m.imagenes.length && `Tiene ${m.imagenes.length} imagen(es) (QR)`,
        ]
          .filter(Boolean)
          .join(' · ')
      )
      .join('\n')
  }
}
