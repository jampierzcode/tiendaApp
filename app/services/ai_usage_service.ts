import AiUsage from '#models/ai_usage'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

/**
 * Precio en USD por millón de tokens [entrada, entrada en caché, salida].
 * Es un ESTIMADO con la lista pública de OpenAI; si cambia, se corrige aquí o
 * con AI_PRICE_INPUT / AI_PRICE_CACHED / AI_PRICE_OUTPUT en el .env.
 */
const PRECIOS: Record<string, [number, number, number]> = {
  'gpt-4o-mini': [0.15, 0.075, 0.6],
  'gpt-4o': [2.5, 1.25, 10],
  'gpt-4.1-nano': [0.1, 0.025, 0.4],
  'gpt-4.1-mini': [0.4, 0.1, 1.6],
  'gpt-4.1': [2, 0.5, 8],
}

function precio(modelo: string): [number, number, number] {
  const i = env.get('AI_PRICE_INPUT')
  const o = env.get('AI_PRICE_OUTPUT')
  if (i !== undefined && o !== undefined) {
    return [Number(i), Number(env.get('AI_PRICE_CACHED') ?? i), Number(o)]
  }
  // "gpt-4o-mini-2024-07-18" → "gpt-4o-mini": se busca el prefijo más largo.
  const clave = Object.keys(PRECIOS)
    .sort((a, b) => b.length - a.length)
    .find((k) => modelo.startsWith(k))
  return PRECIOS[clave ?? 'gpt-4o-mini']
}

/** Consumo de OpenAI del vendedor IA, para el superadmin. */
export default class AiUsageService {
  static async registrar(businessId: number | null, modelo: string, usage: any) {
    if (!usage) return
    const entrada = Number(usage.prompt_tokens ?? 0)
    const cache = Number(usage.prompt_tokens_details?.cached_tokens ?? 0)
    const salida = Number(usage.completion_tokens ?? 0)
    const [pi, pc, po] = precio(modelo)
    const costo = ((entrada - cache) * pi + cache * pc + salida * po) / 1_000_000
    await AiUsage.create({
      businessId,
      model: modelo.slice(0, 60),
      promptTokens: entrada,
      cachedTokens: cache,
      completionTokens: salida,
      costUsd: Number(costo.toFixed(6)),
    })
  }

  /** Resumen: hoy, este mes, por día (30 días) y por negocio (este mes). */
  static async resumen() {
    const zona = env.get('REPORTS_TIMEZONE', 'America/Lima')
    const ahora = DateTime.now().setZone(zona)
    const inicioMes = ahora.startOf('month').toUTC().toSQL()!
    const inicioHoy = ahora.startOf('day').toUTC().toSQL()!
    const hace30 = ahora.minus({ days: 29 }).startOf('day').toUTC().toSQL()!

    const total = async (desde: string) => {
      const f = await db
        .from('ai_usage')
        .where('created_at', '>=', desde)
        .select(
          db.raw('COALESCE(SUM(cost_usd),0) AS costo'),
          db.raw('COUNT(*) AS llamadas'),
          db.raw('COALESCE(SUM(prompt_tokens + completion_tokens),0) AS tokens')
        )
        .first()
      return {
        costoUsd: Number(f?.costo ?? 0),
        llamadas: Number(f?.llamadas ?? 0),
        tokens: Number(f?.tokens ?? 0),
      }
    }

    const porDia = await db
      .from('ai_usage')
      .where('created_at', '>=', hace30)
      .select(
        db.raw(`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE ?, 'YYYY-MM-DD') AS dia`, [zona]),
        db.raw('SUM(cost_usd) AS costo'),
        db.raw('COUNT(*) AS llamadas')
      )
      .groupBy('dia')
      .orderBy('dia', 'asc')

    const porNegocio = await db
      .from('ai_usage')
      .leftJoin('businesses', 'businesses.id', 'ai_usage.business_id')
      .where('ai_usage.created_at', '>=', inicioMes)
      .select(
        'ai_usage.business_id',
        'businesses.name',
        db.raw('SUM(ai_usage.cost_usd) AS costo'),
        db.raw('COUNT(*) AS llamadas'),
        db.raw('SUM(ai_usage.prompt_tokens + ai_usage.completion_tokens) AS tokens')
      )
      .groupBy('ai_usage.business_id', 'businesses.name')
      .orderBy('costo', 'desc')
      .limit(50)

    // Días transcurridos del mes → proyección lineal a fin de mes.
    const mes = await total(inicioMes)
    const dias = Math.max(1, ahora.day)
    const proyeccion = (mes.costoUsd / dias) * ahora.daysInMonth!

    return {
      hoy: await total(inicioHoy),
      mes,
      proyeccionMesUsd: Number(proyeccion.toFixed(4)),
      presupuestoMesUsd: env.get('AI_MONTHLY_BUDGET_USD')
        ? Number(env.get('AI_MONTHLY_BUDGET_USD'))
        : null,
      modelo: env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
      porDia: porDia.map((d: any) => ({
        dia: d.dia,
        costoUsd: Number(d.costo),
        llamadas: Number(d.llamadas),
      })),
      porNegocio: porNegocio.map((n: any) => ({
        businessId: n.business_id,
        negocio: n.name ?? '(sin negocio)',
        costoUsd: Number(n.costo),
        llamadas: Number(n.llamadas),
        tokens: Number(n.tokens),
      })),
      costosReales: await this.costosReales(),
    }
  }

  /**
   * Gasto real del mes según OpenAI. Solo funciona con una Admin key
   * (OPENAI_ADMIN_KEY); la clave normal no puede leer facturación.
   */
  static async costosReales() {
    const clave = env.get('OPENAI_ADMIN_KEY')
    if (!clave) return { disponible: false as const }
    try {
      const inicio = Math.floor(DateTime.now().toUTC().startOf('month').toSeconds())
      const res = await fetch(
        `https://api.openai.com/v1/organization/costs?start_time=${inicio}&bucket_width=1d&limit=31`,
        { headers: { authorization: `Bearer ${clave}` }, signal: AbortSignal.timeout(10000) }
      )
      if (!res.ok) return { disponible: false as const, error: `OpenAI respondió ${res.status}` }
      const data: any = await res.json()
      let usd = 0
      for (const b of data.data ?? []) {
        for (const r of b.results ?? []) usd += Number(r.amount?.value ?? 0)
      }
      return { disponible: true as const, mesUsd: Number(usd.toFixed(4)) }
    } catch (error) {
      return { disponible: false as const, error: (error as Error).message }
    }
  }
}
