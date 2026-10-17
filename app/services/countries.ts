/**
 * Países donde se opera. De aquí salen el impuesto de las ventas y el formato
 * del teléfono de WhatsApp: el negocio elige su país y no se define nada por
 * producto.
 */
export type CodigoPais = 'PE' | 'MX' | 'CL'

export const PAISES: Record<
  CodigoPais,
  {
    nombre: string
    /** Código de marcado internacional. */
    dial: string
    /** Dígitos del número nacional. */
    largo: number
    /** Los celulares empiezan con este dígito (si aplica). */
    inicio?: string
    impuesto: { nombre: string; tasa: number }
    /** Zona horaria: «hoy» y «viernes» se miran con la hora del país del negocio. */
    zona: string
  }
> = {
  PE: { nombre: 'Perú', dial: '51', largo: 9, inicio: '9', impuesto: { nombre: 'IGV', tasa: 18 }, zona: 'America/Lima' },
  MX: { nombre: 'México', dial: '52', largo: 10, impuesto: { nombre: 'IVA', tasa: 16 }, zona: 'America/Mexico_City' },
  CL: { nombre: 'Chile', dial: '56', largo: 9, inicio: '9', impuesto: { nombre: 'IVA', tasa: 19 }, zona: 'America/Santiago' },
}

export const CODIGOS_PAIS = Object.keys(PAISES) as CodigoPais[]

export const esPais = (v: unknown): v is CodigoPais => typeof v === 'string' && v in PAISES

/** Valida un WhatsApp (solo dígitos, con código de país) contra el país del negocio. */
export function validarWhatsapp(pais: CodigoPais, digitos: string): string | null {
  const p = PAISES[pais]
  if (!digitos.startsWith(p.dial)) {
    return `El número debe ser de ${p.nombre} (empieza con +${p.dial})`
  }
  const nacional = digitos.slice(p.dial.length)
  if (nacional.length !== p.largo) {
    return `Un número de ${p.nombre} lleva ${p.largo} dígitos después de +${p.dial}`
  }
  if (p.inicio && !nacional.startsWith(p.inicio)) {
    return `Los celulares de ${p.nombre} empiezan con ${p.inicio}`
  }
  return null
}

/**
 * Revisa el WhatsApp de un cliente (solo dígitos). Acepta el número con código
 * de país o solo el nacional del país de la tienda. Devuelve el motivo si
 * parece incompleto o equivocado; null si está bien.
 */
export function revisarTelefonoCliente(paisTienda: CodigoPais, digitos: string): string | null {
  const tienda = PAISES[paisTienda] ?? PAISES.PE
  const cumple = (p: (typeof PAISES)[CodigoPais], nacional: string) =>
    nacional.length === p.largo && (!p.inicio || nacional.startsWith(p.inicio))

  // Solo el número nacional del país de la tienda.
  if (cumple(tienda, digitos)) return null

  // Con código de uno de los países que validamos.
  for (const p of Object.values(PAISES)) {
    if (digitos.startsWith(p.dial) && cumple(p, digitos.slice(p.dial.length))) return null
  }
  const conCodigoConocido = Object.values(PAISES).find((p) => digitos.startsWith(p.dial))
  if (conCodigoConocido) {
    return `El WhatsApp parece incompleto: un número de ${conCodigoConocido.nombre} lleva ${conCodigoConocido.largo} dígitos después de +${conCodigoConocido.dial}`
  }
  // Otros países: con código de país el número completo tiene al menos 10 dígitos.
  if (digitos.length >= 10 && digitos.length <= 15) return null
  return `El WhatsApp parece incompleto: un número de ${tienda.nombre} lleva ${tienda.largo} dígitos`
}
