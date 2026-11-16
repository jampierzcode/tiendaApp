import type Business from '#models/business'
import PricingService from '#services/pricing_service'
import { DateTime } from 'luxon'

/**
 * Configuración del vendedor IA: personalidad, saludo, preguntas frecuentes y
 * zonas de envío con sus tipos de entrega (al estilo de yavendió!).
 *
 * Se guarda como JSON en `businesses.ai_agent_config` y
 * `businesses.shipping_zones`. Todo lo que entra del panel pasa por
 * `limpiar*()`: nunca se guarda un objeto tal como llegó.
 */

export type TipoCosto = 'gratis' | 'fijo' | 'rango' | 'transportista'
export type ClaseEntrega = 'motorizado' | 'agencia' | 'recojo' | 'otro'
export type TipoPago = 'adelantado' | 'contraentrega' | 'tienda'

export interface Horario {
  desde: string
  hasta: string
  promesa: string
}

export interface TipoEntrega {
  id: string
  nombre: string
  clase: ClaseEntrega
  activo: boolean
  costo: { tipo: TipoCosto; monto: number | null; maximo: number | null; referencia: string }
  /** Envío gratis si los productos suman MÁS que esto. Null = nunca. */
  gratisDesde: number | null
  /** 1 = lunes … 7 = domingo. Vacío = todos los días. */
  dias: number[]
  horarios: Horario[]
  /** Promesa fuera de los horarios (o en días sin entrega). */
  promesaResto: string
  pago: {
    tipo: TipoPago
    parcial: boolean
    minimoTipo: 'monto' | 'porcentaje'
    minimo: number | null
  }
  /** Datos que el vendedor debe pedir antes de cerrar. */
  datos: string[]
  /** Dirección de la agencia o del punto de recojo, si aplica. */
  direccion: string
  reglas: string
  soloRespaldo: boolean
  /** Pedido mínimo (en productos) para usar esta entrega. Null = sin mínimo. */
  minimo: number | null
}

export interface ZonaEnvio {
  id: string
  nombre: string
  activa: boolean
  regiones: string[]
  tipos: TipoEntrega[]
}

export interface PreguntaFrecuente {
  id: string
  categoria: string
  pregunta: string
  respuesta: string
  activa: boolean
}

/** Sede de una agencia (Shalom, Olva…) que carga el dueño, a mano o desde Excel. */
export interface Sede {
  id: string
  empresa: string
  departamento: string
  provincia: string
  distrito: string
  nombre: string
  direccion: string
  referencia: string
}

/** Lo propio de un restaurante: horario por día, tiempos, sugerencias y reservas. */
export interface ConfigRestaurante {
  /** 1 = lunes … 7 = domingo; un día sin fila está cerrado. */
  horario: { dia: number; abre: string; cierra: string }[]
  mensajeCerrado: string
  /** Fuera de horario, ¿se toman pedidos para cuando abra? */
  programados: boolean
  /** Minutos de preparación en cocina (recojo / mesa). */
  prepMin: number | null
  /** Qué ofrecer para subir el ticket: bebida, postre, agrandar… */
  sugerencias: string
  reservas: { activo: boolean; instrucciones: string }
}

export interface ConfigVendedor {
  nombre: string
  publico: string
  tono: 'amigable' | 'profesional' | 'divertido' | 'formal'
  trato: 'tu' | 'usted'
  largo: 'corto' | 'medio'
  emojis: 'ninguno' | 'pocos' | 'muchos'
  palabrasEvitar: string
  fotos: 'siempre' | 'cuando_ayude' | 'nunca'
  saludo: { activo: boolean; modo: 'exacto' | 'exacto_responde' | 'adaptado'; texto: string }
  faqs: PreguntaFrecuente[]
  ejemplo: string
  derivarCuando: string[]
  descuentos: string
  sedes: Sede[]
  restaurante: ConfigRestaurante
}

export const DATOS_SUGERIDOS = [
  'Nombre completo',
  'DNI',
  'Teléfono',
  'Correo',
  'Dirección',
  'Referencia',
  'Ubicación GPS',
  'Departamento / ciudad',
  'Agencia de recojo',
]

export const CONFIG_POR_DEFECTO: ConfigVendedor = {
  nombre: '',
  publico: '',
  tono: 'amigable',
  trato: 'tu',
  largo: 'corto',
  emojis: 'pocos',
  palabrasEvitar: '',
  fotos: 'siempre',
  saludo: { activo: false, modo: 'adaptado', texto: '' },
  faqs: [],
  ejemplo: '',
  derivarCuando: ['Problema con el pago', 'Devolución o cambio', 'Queja grave'],
  descuentos: '',
  sedes: [],
  restaurante: {
    horario: [],
    mensajeCerrado: '',
    programados: false,
    prepMin: null,
    sugerencias: '',
    reservas: { activo: false, instrucciones: '' },
  },
}

const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? PricingService.redondear(n) : null
}
const uno = <T extends string>(v: unknown, opciones: readonly T[], porDefecto: T): T =>
  opciones.includes(v as T) ? (v as T) : porDefecto
const id = (v: unknown) => texto(v, 40) || Math.random().toString(36).slice(2, 10)
const hora = (v: unknown, porDefecto: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : porDefecto
const lista = (v: unknown, max: number, largo: number) =>
  [
    ...new Set(
      (Array.isArray(v) ? v : [])
        .map((x) => texto(x, largo))
        .filter(Boolean)
    ),
  ].slice(0, max)

function parse<T>(crudo: string | null | undefined, porDefecto: T): T {
  if (!crudo) return porDefecto
  try {
    return JSON.parse(crudo) as T
  } catch {
    return porDefecto
  }
}

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

export default class SellerConfigService {
  static config(business: Business): ConfigVendedor {
    return this.limpiarConfig(parse(business.aiAgentConfig, {}))
  }

  static zonas(business: Business): ZonaEnvio[] {
    return this.limpiarZonas(parse(business.shippingZones, []))
  }

  static limpiarConfig(crudo: any): ConfigVendedor {
    const c = crudo && typeof crudo === 'object' ? crudo : {}
    const d = CONFIG_POR_DEFECTO
    return {
      nombre: texto(c.nombre, 60),
      publico: texto(c.publico, 400),
      tono: uno(c.tono, ['amigable', 'profesional', 'divertido', 'formal'] as const, d.tono),
      trato: uno(c.trato, ['tu', 'usted'] as const, d.trato),
      largo: uno(c.largo, ['corto', 'medio'] as const, d.largo),
      emojis: uno(c.emojis, ['ninguno', 'pocos', 'muchos'] as const, d.emojis),
      palabrasEvitar: texto(c.palabrasEvitar, 400),
      fotos: uno(c.fotos, ['siempre', 'cuando_ayude', 'nunca'] as const, d.fotos),
      saludo: {
        activo: Boolean(c.saludo?.activo),
        modo: uno(
          c.saludo?.modo,
          ['exacto', 'exacto_responde', 'adaptado'] as const,
          d.saludo.modo
        ),
        texto: texto(c.saludo?.texto, 1500),
      },
      faqs: (Array.isArray(c.faqs) ? c.faqs : [])
        .slice(0, 100)
        .map((f: any) => ({
          id: id(f?.id),
          categoria: texto(f?.categoria, 60) || 'Otros',
          pregunta: texto(f?.pregunta, 300),
          respuesta: texto(f?.respuesta, 1500),
          activa: f?.activa !== false,
        }))
        .filter((f: PreguntaFrecuente) => f.pregunta && f.respuesta),
      ejemplo: texto(c.ejemplo, 4000),
      derivarCuando: Array.isArray(c.derivarCuando)
        ? lista(c.derivarCuando, 20, 120)
        : d.derivarCuando,
      descuentos: texto(c.descuentos, 600),
      sedes: (Array.isArray(c.sedes) ? c.sedes : [])
        .slice(0, 3000)
        .map((x: any) => ({
          id: id(x?.id),
          empresa: texto(x?.empresa, 60) || 'Agencia',
          departamento: texto(x?.departamento, 60),
          provincia: texto(x?.provincia, 60),
          distrito: texto(x?.distrito, 60),
          nombre: texto(x?.nombre, 120),
          direccion: texto(x?.direccion, 250),
          referencia: texto(x?.referencia, 200),
        }))
        .filter((x: Sede) => x.direccion || x.nombre),
      restaurante: {
        horario: (Array.isArray(c.restaurante?.horario) ? c.restaurante.horario : [])
          .map((h: any) => ({
            dia: Number(h?.dia),
            abre: hora(h?.abre, '12:00'),
            cierra: hora(h?.cierra, '22:00'),
          }))
          .filter((h: any) => Number.isInteger(h.dia) && h.dia >= 1 && h.dia <= 7)
          .slice(0, 14),
        mensajeCerrado: texto(c.restaurante?.mensajeCerrado, 500),
        programados: Boolean(c.restaurante?.programados),
        prepMin: numero(c.restaurante?.prepMin),
        sugerencias: texto(c.restaurante?.sugerencias, 600),
        reservas: {
          activo: Boolean(c.restaurante?.reservas?.activo),
          instrucciones: texto(c.restaurante?.reservas?.instrucciones, 600),
        },
      },
    }
  }

  static limpiarZonas(crudo: any): ZonaEnvio[] {
    return (Array.isArray(crudo) ? crudo : []).slice(0, 30).map((z: any) => ({
      id: id(z?.id),
      nombre: texto(z?.nombre, 80) || 'Sin nombre',
      activa: z?.activa !== false,
      regiones: lista(z?.regiones, 300, 80),
      tipos: (Array.isArray(z?.tipos) ? z.tipos : []).slice(0, 10).map((t: any) => {
        const costoTipo = uno(t?.costo?.tipo, ['gratis', 'fijo', 'rango', 'transportista'] as const, 'fijo')
        return {
          id: id(t?.id),
          nombre: texto(t?.nombre, 60) || 'Entrega',
          clase: uno(t?.clase, ['motorizado', 'agencia', 'recojo', 'otro'] as const, 'otro'),
          activo: t?.activo !== false,
          costo: {
            tipo: costoTipo,
            monto: numero(t?.costo?.monto),
            maximo: costoTipo === 'rango' ? numero(t?.costo?.maximo) : null,
            referencia: texto(t?.costo?.referencia, 60),
          },
          gratisDesde: costoTipo === 'transportista' ? null : numero(t?.gratisDesde),
          dias: [...new Set<number>((Array.isArray(t?.dias) ? t.dias : []).map(Number))]
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
            .sort() as number[],
          horarios: (Array.isArray(t?.horarios) ? t.horarios : []).slice(0, 6).map((h: any) => ({
            desde: hora(h?.desde, '00:00'),
            hasta: hora(h?.hasta, '00:00'),
            promesa: texto(h?.promesa, 120),
          })),
          promesaResto: texto(t?.promesaResto, 120),
          pago: {
            tipo: uno(t?.pago?.tipo, ['adelantado', 'contraentrega', 'tienda'] as const, 'adelantado'),
            parcial: Boolean(t?.pago?.parcial),
            minimoTipo: uno(t?.pago?.minimoTipo, ['monto', 'porcentaje'] as const, 'monto'),
            minimo: numero(t?.pago?.minimo),
          },
          datos: lista(t?.datos, 15, 60),
          direccion: texto(t?.direccion, 300),
          reglas: texto(t?.reglas, 1000),
          soloRespaldo: Boolean(t?.soloRespaldo),
          minimo: numero(t?.minimo),
        }
      }),
    }))
  }

  /** Tipos de entrega que el vendedor puede ofrecer (zona y tipo activos). */
  static activas(business: Business) {
    return this.zonas(business)
      .filter((z) => z.activa)
      .map((z) => ({ ...z, tipos: z.tipos.filter((t) => t.activo) }))
      .filter((z) => z.tipos.length)
  }

  static buscarTipo(business: Business, tipoId: string) {
    for (const zona of this.activas(business)) {
      const tipo = zona.tipos.find((t) => t.id === tipoId)
      if (tipo) return { zona, tipo }
    }
    return null
  }

  /** ¿Esta región (distrito, provincia…) está en la zona? */
  static cubre(zona: ZonaEnvio, lugar: string) {
    const l = normalizar(lugar)
    return zona.regiones.some((r) => {
      const n = normalizar(r)
      return n === l || l.includes(n) || n.includes(l)
    })
  }

  /**
   * Costo de envío real según el monto de los productos (ya con descuentos).
   * `porConfirmar`: el monto final depende del transportista o del destino.
   */
  static costo(tipo: TipoEntrega, netoProductos: number, simbolo: string) {
    const c = tipo.costo
    const gratisPorMonto =
      tipo.gratisDesde !== null && netoProductos > tipo.gratisDesde && c.tipo !== 'transportista'
    if (c.tipo === 'gratis' || gratisPorMonto) {
      return { monto: 0, detalle: gratisPorMonto ? 'Gratis por el monto de la compra' : 'Gratis' }
    }
    if (c.tipo === 'transportista') {
      return {
        monto: 0,
        porConfirmar: true,
        detalle: `Lo paga el cliente al transportista/agencia (no se suma al pedido)${c.referencia ? `: ${c.referencia}` : ''}`,
      }
    }
    const monto = c.monto ?? 0
    if (c.tipo === 'rango') {
      return {
        monto,
        porConfirmar: true,
        detalle: `Entre ${simbolo} ${monto.toFixed(2)} y ${simbolo} ${(c.maximo ?? monto).toFixed(2)} según el destino${c.referencia ? ` (${c.referencia})` : ''}; se cobra el mínimo y el negocio confirma`,
      }
    }
    return { monto, detalle: `${simbolo} ${monto.toFixed(2)}` }
  }

  /** Lo que hay que pagar antes del envío (null = no se adelanta nada). */
  static adelanto(tipo: TipoEntrega, total: number) {
    if (tipo.pago.tipo !== 'adelantado') return null
    if (!tipo.pago.parcial || tipo.pago.minimo === null) return PricingService.redondear(total)
    const minimo =
      tipo.pago.minimoTipo === 'porcentaje'
        ? (total * Math.min(100, tipo.pago.minimo)) / 100
        : tipo.pago.minimo
    return PricingService.redondear(Math.min(total, minimo))
  }

  /** Qué se le promete al cliente si pide ahora mismo. */
  static promesaAhora(tipo: TipoEntrega, ahora: DateTime) {
    const dia = ahora.weekday
    if (tipo.dias.length && !tipo.dias.includes(dia)) {
      return tipo.promesaResto || 'Se entrega el siguiente día de reparto'
    }
    const minutos = ahora.hour * 60 + ahora.minute
    const aMin = (h: string) => {
      const [hh, mm] = h.split(':').map(Number)
      return hh * 60 + mm
    }
    for (const h of tipo.horarios) {
      const desde = aMin(h.desde)
      // "00:00" como fin es medianoche (fin del día).
      const hasta = aMin(h.hasta) || 24 * 60
      const dentro =
        desde < hasta ? minutos >= desde && minutos < hasta : minutos >= desde || minutos < hasta
      if (dentro && h.promesa) return h.promesa
    }
    return tipo.promesaResto || null
  }

  /**
   * ¿El restaurante está abierto ahora? Sin horario cargado se asume abierto
   * (decide el texto libre de "Horario" del negocio). Un turno que cruza la
   * medianoche (19:00–02:00) cuenta para el día en que empieza.
   */
  static estadoRestaurante(business: Business, ahora: DateTime) {
    const h = this.config(business).restaurante.horario
    if (!h.length) return { conHorario: false, abierto: true, hoy: '', proximo: '' }
    const aMin = (x: string) => {
      const [hh, mm] = x.split(':').map(Number)
      return hh * 60 + mm
    }
    const min = ahora.hour * 60 + ahora.minute
    const dentro = (t: { abre: string; cierra: string }, m: number, ayer: boolean) => {
      const a = aMin(t.abre)
      const c = aMin(t.cierra) || 24 * 60
      if (a < c) return !ayer && m >= a && m < c
      return ayer ? m < c : m >= a
    }
    const dia = ahora.weekday
    const diaAyer = dia === 1 ? 7 : dia - 1
    const abierto =
      h.some((t) => t.dia === dia && dentro(t, min, false)) ||
      h.some((t) => t.dia === diaAyer && dentro(t, min, true))
    const nombres = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
    const hoy = h
      .filter((t) => t.dia === dia)
      .map((t) => `${t.abre}–${t.cierra}`)
      .join(' y ')
    // Próxima apertura (hoy más tarde o en los próximos 7 días).
    let proximo = ''
    for (let i = 0; i < 8 && !proximo; i++) {
      const d = ((dia - 1 + i) % 7) + 1
      const turnos = h
        .filter((t) => t.dia === d && (i > 0 || aMin(t.abre) > min))
        .sort((a, b) => aMin(a.abre) - aMin(b.abre))
      if (turnos.length) proximo = `${i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${nombres[d]}`} a las ${turnos[0].abre}`
    }
    return { conHorario: true, abierto, hoy, proximo }
  }

  /** Horario semanal en texto, agrupando días iguales. */
  static textoHorario(business: Business) {
    const h = this.config(business).restaurante.horario
    const nombres = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    return [1, 2, 3, 4, 5, 6, 7]
      .map((d) => {
        const t = h.filter((x) => x.dia === d).map((x) => `${x.abre}–${x.cierra}`)
        return `${nombres[d]}: ${t.length ? t.join(' y ') : 'cerrado'}`
      })
      .join(' · ')
  }

  static textoPago(tipo: TipoEntrega, simbolo: string) {
    const p = tipo.pago
    if (p.tipo === 'contraentrega') return 'Contra entrega (paga al recibir)'
    if (p.tipo === 'tienda') return 'Paga en la tienda al recoger'
    if (p.parcial && p.minimo !== null) {
      return `Adelantado: mínimo ${p.minimoTipo === 'porcentaje' ? `${p.minimo}% del total` : `${simbolo} ${p.minimo.toFixed(2)}`} y el saldo al recibir/recoger`
    }
    return 'Adelantado (paga todo antes del envío)'
  }

  /** Empresas con sedes cargadas y cuántas tiene cada una. */
  static empresasConSedes(business: Business) {
    const conteo = new Map<string, number>()
    for (const s of this.config(business).sedes) {
      const k = normalizar(s.empresa)
      conteo.set(k, (conteo.get(k) ?? 0) + 1)
    }
    return conteo
  }

  /**
   * Sedes de una empresa en el lugar que dijo el cliente (departamento,
   * provincia, distrito o parte del nombre). Sin tildes ni mayúsculas.
   */
  static buscarSedes(business: Business, empresa: string, lugar: string) {
    const sedes = this.config(business).sedes
    const e = normalizar(empresa)
    const deEmpresa = sedes.filter((s) => {
      const n = normalizar(s.empresa)
      return !e || n.includes(e) || e.includes(n)
    })
    const palabras = normalizar(lugar)
      .split(/[\s,]+/)
      .filter((p) => p.length >= 3)
    if (!palabras.length) return { total: deEmpresa.length, sedes: [] as Sede[] }
    const puntaje = (s: Sede) => {
      let p = 0
      const campos = [
        [normalizar(s.distrito), 4],
        [normalizar(s.provincia), 3],
        [normalizar(s.departamento), 2],
        [normalizar(`${s.nombre} ${s.direccion}`), 1],
      ] as const
      for (const w of palabras) {
        for (const [c, peso] of campos) {
          if (c && (c === w || c.includes(w))) {
            p += peso
            break
          }
        }
      }
      return p
    }
    const hallados = deEmpresa
      .map((s) => ({ s, p: puntaje(s) }))
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p)
    return { total: deEmpresa.length, sedes: hallados.slice(0, 10).map((x) => x.s) }
  }

  /** Bloque de texto para el prompt del vendedor. */
  static textoEnvios(business: Business, ahora: DateTime) {
    const simbolo = business.currencySymbol || 'S/'
    const dias = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
    const sedes = this.empresasConSedes(business)
    return this.activas(business)
      .map((z) => {
        const tipos = z.tipos
          .map((t) => {
            const c = t.costo
            const costo =
              c.tipo === 'gratis'
                ? 'gratis'
                : c.tipo === 'transportista'
                  ? `lo cobra el transportista al cliente${c.referencia ? ` (${c.referencia})` : ''}`
                  : c.tipo === 'rango'
                    ? `entre ${simbolo} ${(c.monto ?? 0).toFixed(2)} y ${simbolo} ${(c.maximo ?? c.monto ?? 0).toFixed(2)}${c.referencia ? ` (${c.referencia})` : ''}`
                    : `${simbolo} ${(c.monto ?? 0).toFixed(2)}`
            const promesa = this.promesaAhora(t, ahora)
            return [
              `  • ${t.nombre} [tipoEntregaId: ${t.id}]${t.soloRespaldo ? ' (SOLO como respaldo: ofrécelo únicamente si ninguna otra opción le sirve)' : ''}`,
              `    Costo: ${costo}${t.gratisDesde !== null ? `; gratis si los productos suman más de ${simbolo} ${t.gratisDesde.toFixed(2)}` : ''}`,
              `    Entrega: ${[
                t.dias.length ? `días ${t.dias.map((d) => dias[d]).join(', ')}` : 'todos los días',
                promesa && `si pide AHORA: "${promesa}"`,
                t.horarios.length > 1 &&
                  `según la hora del pedido: ${t.horarios.map((h) => `${h.desde}-${h.hasta} → ${h.promesa}`).join('; ')}`,
              ]
                .filter(Boolean)
                .join('. ')}`,
              `    Pago: ${this.textoPago(t, simbolo)}`,
              t.minimo !== null && `    Pedido mínimo: ${simbolo} ${t.minimo.toFixed(2)} en productos`,
              t.direccion && `    Dirección (${t.clase === 'recojo' ? 'punto de recojo' : 'agencia'}): ${t.direccion}`,
              t.datos.length && `    Datos que DEBES pedir: ${t.datos.join(', ')}`,
              t.clase === 'agencia' &&
                sedes.has(normalizar(t.nombre)) &&
                `    Sedes: hay ${sedes.get(normalizar(t.nombre))} sedes de ${t.nombre} cargadas. Cuando el cliente diga su ciudad, usa "buscar_sedes" (empresa: "${t.nombre}") y muéstrale las opciones numeradas con su dirección para que elija.`,
              t.reglas && `    Reglas: ${t.reglas}`,
            ]
              .filter(Boolean)
              .join('\n')
          })
          .join('\n')
        return `- Zona "${z.nombre}" — cubre: ${z.regiones.length ? z.regiones.join(', ') : '(sin regiones; pregúntale al negocio)'}\n${tipos}`
      })
      .join('\n')
  }
}
