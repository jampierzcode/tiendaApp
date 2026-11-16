import type Business from '#models/business'
import Category from '#models/category'
import Customer from '#models/customer'
import ModifierOption from '#models/modifier_option'
import Notification from '#models/notification'
import Order from '#models/order'
import Product from '#models/product'
import ProductModifierGroup from '#models/product_modifier_group'
import WhatsappAgentPause from '#models/whatsapp_agent_pause'
import WhatsappMessage from '#models/whatsapp_message'
import NotificationService from '#services/notification_service'
import OrderService, { OrderError } from '#services/order_service'
import PanelNotificationService from '#services/panel_notification_service'
import PricingService from '#services/pricing_service'
import PromotionService from '#services/promotion_service'
import PushService from '#services/push_service'
import VariationService from '#services/variation_service'
import { revisarTelefonoCliente, type CodigoPais } from '#services/countries'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

/**
 * Asistente de ventas por WhatsApp.
 *
 * Un modelo de lenguaje conversa con el cliente con naturalidad y, para todo
 * lo que sea dato (precios, stock, pedidos), llama a herramientas que leen la
 * base. Nunca inventa: si una herramienta no lo devuelve, no existe.
 *
 * Los pedidos se crean con el mismo OrderService de la tienda pública, así que
 * precios, promociones, stock y validaciones son exactamente los mismos.
 */

export interface MediaSalida {
  url: string
  caption?: string
}

export interface RespuestaAgente {
  reply: string | null
  media: MediaSalida[]
}

interface Contexto {
  business: Business
  /** Teléfono tal como llegó del bot (puede ser un id @lid si WhatsApp no dio el número). */
  phone: string
  media: MediaSalida[]
  pedidoCreado: Order | null
}

type MensajeChat =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: any[] }
  | { role: 'tool'; tool_call_id: string; content: string }

const MAX_VUELTAS = 6
const HISTORIAL_MAX = 24

const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Columna sin tildes ni mayúsculas, para comparar contra `normalizar()`. */
const SIN_TILDES = (col: string) => `translate(lower(${col}), 'áéíóúüñàèìòù', 'aeiouunaeiou')`

export default class SalesAgentService {
  static disponible() {
    return Boolean(env.get('OPENAI_API_KEY'))
  }

  static pausaHumanoMin() {
    return Number(env.get('AI_AGENT_HUMAN_PAUSE_MIN') ?? 120)
  }

  /** ¿El dueño tomó esta conversación? Mientras tanto el asistente calla. */
  static async enPausa(businessId: number, phone: string) {
    const contacto = phone.replace(/\D/g, '').slice(-9)
    const pausa = await WhatsappAgentPause.query()
      .where('business_id', businessId)
      .andWhere('contact', contacto)
      .first()
    return Boolean(pausa && pausa.pausedUntil > DateTime.now())
  }

  static async pausar(businessId: number, phone: string, minutos: number, motivo: string | null) {
    const contacto = phone.replace(/\D/g, '').slice(-9)
    if (!contacto) return
    await WhatsappAgentPause.updateOrCreate(
      { businessId, contact: contacto },
      {
        pausedUntil: DateTime.now().plus({ minutes: minutos }),
        reason: motivo?.slice(0, 255) ?? null,
      }
    )
  }

  static async reanudar(businessId: number, contacto: string) {
    await WhatsappAgentPause.query()
      .where('business_id', businessId)
      .andWhere('contact', contacto.replace(/\D/g, '').slice(-9))
      .delete()
  }

  /**
   * Contesta un mensaje del cliente. Devuelve null si no debe responder
   * (asistente apagado, sin clave o conversación tomada por el dueño).
   */
  static async responder(
    business: Business,
    phone: string,
    texto: string,
    mensajeId: number | null
  ): Promise<RespuestaAgente | null> {
    if (!this.disponible() || !business.aiAgentEnabled) return null
    if (await this.enPausa(business.id, phone)) return null

    const ctx: Contexto = { business, phone, media: [], pedidoCreado: null }
    const messages: MensajeChat[] = [
      { role: 'system', content: await this.prompt(business, phone) },
      ...(await this.historial(business.id, phone, mensajeId)),
      { role: 'user', content: texto },
    ]

    let final: string | null = null
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const m = await this.llamarModelo(messages)
      messages.push({ role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls })

      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let args: any = {}
          try {
            args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
          } catch {
            args = {}
          }
          let resultado: unknown
          try {
            resultado = await this.ejecutar(tc.function?.name, args, ctx)
          } catch (error) {
            logger.error({ err: error, tool: tc.function?.name }, 'Herramienta del asistente falló')
            resultado = { error: 'No se pudo completar esta consulta ahora.' }
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultado) })
        }
        continue
      }

      final = m.content?.trim() || null
      break
    }

    if (!final && ctx.pedidoCreado) {
      // El modelo agotó las vueltas tras crear el pedido: igual se confirma.
      final = `¡Listo! Registramos tu pedido *${ctx.pedidoCreado.code}*. Síguelo aquí: ${NotificationService.enlaceSeguimiento(business, ctx.pedidoCreado)}`
    }

    return { reply: final ? this.formatoWhatsapp(final) : null, media: ctx.media }
  }

  // ---------------------------------------------------------------------
  // Modelo
  // ---------------------------------------------------------------------

  private static async llamarModelo(messages: MensajeChat[]) {
    const base = (env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${env.get('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify({
        model: env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(45000),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      throw new Error(`OpenAI ${res.status}: ${detalle.slice(0, 300)}`)
    }
    const data: any = await res.json()
    return data.choices?.[0]?.message ?? { content: null }
  }

  /** WhatsApp no es Markdown: negrita con un asterisco y enlaces crudos. */
  static formatoWhatsapp(texto: string) {
    return texto
      .replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt: string, url: string) => {
        const limpio = (txt || '').trim()
        if (!limpio || limpio === url || /^https?:\/\//i.test(limpio)) return url
        return `${limpio}: ${url}`
      })
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/^#{1,6}\s+/gm, '')
      .trim()
  }

  // ---------------------------------------------------------------------
  // Contexto: prompt e historial
  // ---------------------------------------------------------------------

  private static async historial(businessId: number, phone: string, excluirId: number | null) {
    const contacto = phone.replace(/\D/g, '').slice(-9)
    const filas = await WhatsappMessage.query()
      .where('business_id', businessId)
      .andWhere('contact', contacto)
      .andWhere('created_at', '>', DateTime.now().minus({ days: 3 }).toSQL()!)
      .if(excluirId, (q) => q.whereNot('id', excluirId!))
      .orderBy('id', 'desc')
      .limit(HISTORIAL_MAX)

    const salida: MensajeChat[] = []
    for (const f of filas.reverse()) {
      const role = f.direction === 'in' ? 'user' : 'assistant'
      const previo = salida[salida.length - 1]
      // Mensajes seguidos del mismo lado se juntan (el modelo espera turnos alternos).
      if (previo && previo.role === role && typeof previo.content === 'string') {
        previo.content += `\n${f.body}`
      } else {
        salida.push({ role, content: f.body } as MensajeChat)
      }
    }
    // Un historial que arranca con el asistente confunde al modelo.
    while (salida[0]?.role === 'assistant') salida.shift()
    return salida
  }

  private static async prompt(business: Business, phone: string) {
    const simbolo = business.currencySymbol || 'S/'
    const base = (env.get('STORE_PUBLIC_URL') ?? '').replace(/\/$/, '')
    const enlace = `${base}/t/${business.slug}`
    const restaurante = business.esRestaurante
    const zona = env.get('REPORTS_TIMEZONE', 'America/Lima')
    const ahora = DateTime.now().setZone(zona).setLocale('es')

    const digitos = phone.replace(/\D/g, '')
    const cliente = await Customer.query()
      .where('business_id', business.id)
      .andWhere('phone', 'like', `%${digitos.slice(-9)}`)
      .first()

    const categorias = await Category.query()
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .orderBy('sort_order', 'asc')
      .limit(40)

    const envio =
      Number(business.shippingCost ?? 0) > 0
        ? `${simbolo} ${Number(business.shippingCost).toFixed(2)}` +
          (business.freeShippingFrom !== null && business.freeShippingFrom !== undefined
            ? ` (gratis desde ${simbolo} ${Number(business.freeShippingFrom).toFixed(2)})`
            : '')
        : 'sin costo'

    const politica = {
      none: 'El pago se coordina con el negocio.',
      on_confirm: 'El pago es POR ADELANTADO: el pedido se prepara cuando el cliente paga.',
      on_delivery: 'El pago es CONTRA ENTREGA (al recibir o recoger).',
    }[business.paymentPolicy ?? 'none']

    const datos = [
      `Negocio: ${business.name}`,
      business.description && `Descripción: ${business.description}`,
      `Tipo: ${restaurante ? 'restaurante / comida (vende platos con opciones)' : 'tienda (vende productos con variaciones: talla, color, etc.)'}`,
      (business.address || business.city) &&
        `Dirección: ${[business.address, business.city].filter(Boolean).join(', ')}`,
      business.schedule && `Horario: ${business.schedule}`,
      business.phone && `Teléfono: ${business.phone}`,
      business.instagram && `Instagram: ${business.instagram}`,
      business.facebook && `Facebook: ${business.facebook}`,
      business.tiktok && `TikTok: ${business.tiktok}`,
      `Catálogo / carta online: ${enlace}`,
      `Moneda: ${business.currency} (${simbolo})`,
      `Envío a domicilio: ${envio}. También se puede recoger en el local${restaurante ? ' o pedir en mesa' : ''}.`,
      `Pago: ${politica}`,
      business.paymentInstructions && `Cómo pagar: ${business.paymentInstructions}`,
      categorias.length && `Categorías: ${categorias.map((c) => c.name).join(', ')}`,
      !business.puedeVender &&
        'IMPORTANTE: ahora mismo el negocio NO está recibiendo pedidos. Informa y no crees pedidos.',
    ]
      .filter(Boolean)
      .join('\n')

    const instrucciones = business.aiAgentInstructions?.trim()

    return `Eres el asistente de ventas de "${business.name}" y atiendes por WhatsApp. Hablas como una persona amable del negocio: natural, cercana y en el español del cliente (por defecto, español peruano). Nada de menús rígidos ni respuestas de robot.

Fecha y hora actual: ${ahora.toFormat("cccc d 'de' LLLL yyyy, HH:mm")}.
${cliente ? `Este cliente ya compró antes: se llama ${cliente.name}${cliente.address ? `, su última dirección fue ${[cliente.address, cliente.city].filter(Boolean).join(', ')}` : ''}. Llámale por su nombre y confirma si la dirección sigue igual antes de usarla.` : 'Es un cliente nuevo o no lo tenemos registrado.'}

DATOS DEL NEGOCIO
${datos}
${instrucciones ? `\nINDICACIONES DEL DUEÑO (síguelas siempre que no contradigan las reglas de abajo)\n${instrucciones}\n` : ''}
TU OBJETIVO
Ayudar al cliente a encontrar lo que busca y cerrar la venta registrando su pedido. Recomienda, resuelve dudas y sugiere un complemento cuando tenga sentido, sin presionar.

CÓMO TRABAJAS
- Para precios, disponibilidad, stock, opciones o pedidos USA LAS HERRAMIENTAS. Nunca inventes productos, precios, stock, promociones, plazos ni datos que no estén arriba o que no devuelva una herramienta.
- Busca con "buscar_productos" (palabras clave cortas, en singular: "polo", "hamburguesa"). Si no aparece, prueba con sinónimos antes de decir que no hay.
- Antes de pedir, revisa el producto con "ver_producto" para conocer ${restaurante ? 'sus opciones obligatorias (p. ej. término, guarnición) y pregúntale al cliente las que falten' : 'sus variaciones (talla, color…) y su stock, y pregúntale al cliente cuál quiere'}.
- Si el producto tiene foto y ayuda a vender, ofrece mandarla y envíala con "enviar_foto_producto".
- Para cerrar el pedido necesitas: productos y cantidades${restaurante ? ' (con sus opciones)' : ' (con la variación exacta)'}, el nombre del cliente y la forma de entrega (envío con dirección, recojo${restaurante ? ', o mesa con su número' : ''}). Pídelo de forma natural, de a pocos.
- Antes de crear el pedido usa "cotizar_pedido" y muéstrale un resumen corto con el total real (incluye envío y descuentos). Créalo con "crear_pedido" SOLO cuando el cliente confirme ("sí", "dale", "confirmo"…).
- Tras crear el pedido, dale el código, el total y el enlace de seguimiento; si el pago es por adelantado, explica cómo pagar con los datos de arriba y pídele que mande la foto del comprobante.
- Si pregunta por un pedido que ya hizo, usa "mis_pedidos".
- Si el cliente manda una foto o comprobante, agradécele y dile que el negocio lo revisará.
- Si pide hablar con una persona, tiene un reclamo, quiere cambiar o cancelar un pedido ya hecho, pide algo que no puedes resolver o se molesta, usa "derivar_a_humano" y avísale que en breve lo atienden.
- Si el mensaje no tiene nada que ver con el negocio, responde con amabilidad y redirige con suavidad.

FORMATO (WhatsApp, no Markdown)
- Respuestas CORTAS: 1 a 5 líneas. Una sola pregunta a la vez. Emojis con moderación.
- Negrita con UN asterisco: *texto*. Nunca **doble**, ni títulos con #, ni tablas.
- Enlaces como URL cruda (https://...), nunca [texto](url).
- Precios siempre con ${simbolo} y dos decimales.`
  }

  // ---------------------------------------------------------------------
  // Herramientas
  // ---------------------------------------------------------------------

  private static async ejecutar(nombre: string, args: any, ctx: Contexto): Promise<unknown> {
    switch (nombre) {
      case 'buscar_productos':
        return this.buscarProductos(ctx.business, String(args?.consulta ?? ''), args?.categoria)
      case 'ver_producto':
        return this.verProducto(ctx.business, Number(args?.productoId))
      case 'enviar_foto_producto':
        return this.enviarFoto(
          ctx,
          Number(args?.productoId),
          args?.variacionId ? Number(args.variacionId) : null
        )
      case 'cotizar_pedido':
        return this.cotizar(ctx.business, args)
      case 'crear_pedido':
        return this.crearPedido(ctx, args)
      case 'mis_pedidos':
        return this.misPedidos(ctx.business, ctx.phone)
      case 'derivar_a_humano':
        return this.derivar(ctx, String(args?.motivo ?? ''))
      default:
        return { error: 'herramienta desconocida' }
    }
  }

  private static async buscarProductos(business: Business, consulta: string, categoria?: string) {
    const palabras = normalizar(consulta)
      .split(/\s+/)
      .map((p) => p.replace(/[^a-z0-9ñ-]/g, ''))
      // Plurales sencillos: «polos» encuentra «polo», «hamburguesas» → «hamburguesa».
      .map((p) =>
        p.length > 4 && p.endsWith('es')
          ? p.slice(0, -2)
          : p.length > 3 && p.endsWith('s')
            ? p.slice(0, -1)
            : p
      )
      .filter((p) => p.length >= 2)

    const consultar = (modo: 'todas' | 'alguna') => {
      const q = Product.query()
        .where('business_id', business.id)
        .andWhere('status', 'activo')
        .where((v) =>
          v
            .whereDoesntHave('categoryLinks', (l) => l)
            .orWhereHas('categoryLinks', (l) =>
              l.whereHas('category', (c) => c.where('is_active', true))
            )
        )
        .preload('categoryLinks', (l) => l.preload('category'))
        .preload('variations')
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .limit(12)

      if (categoria?.trim()) {
        const cat = `%${normalizar(String(categoria))}%`
        q.whereHas('categoryLinks', (l) =>
          l.whereHas('category', (c) => c.whereRaw(`${SIN_TILDES('name')} like ?`, [cat]))
        )
      }
      if (palabras.length) {
        q.where((w) => {
          for (const p of palabras) {
            const patron = `%${p}%`
            const cond = (x: any) =>
              x
                .whereRaw(`${SIN_TILDES('products.name')} like ?`, [patron])
                .orWhereRaw(`${SIN_TILDES("coalesce(products.description, '')")} like ?`, [patron])
                .orWhereHas('categoryLinks', (l: any) =>
                  l.whereHas('category', (c: any) =>
                    c.whereRaw(`${SIN_TILDES('name')} like ?`, [patron])
                  )
                )
            if (modo === 'todas') w.where(cond)
            else w.orWhere(cond)
          }
        })
      }
      return q
    }

    let productos = await consultar('todas')
    if (!productos.length && palabras.length > 1) productos = await consultar('alguna')

    const promos = await PromotionService.activas(business.id)
    const simbolo = business.currencySymbol || 'S/'

    return {
      moneda: simbolo,
      resultados: productos.map((p) => {
        const categoryIds = p.categoryLinks.map((l) => l.categoryId)
        const precio = PromotionService.precioPublico(promos, p.id, categoryIds, Number(p.price))
        const visibles = VariationService.visibles(p.variations ?? [])
        const precios = visibles.map((v) => Number(v.price))
        const stock = visibles.reduce((t, v) => t + Math.max(0, v.stock), 0)
        return {
          productoId: p.id,
          nombre: p.name,
          descripcion: p.description?.slice(0, 160) ?? null,
          categoria:
            p.categoryLinks
              .map((l) => l.category?.name)
              .filter(Boolean)
              .join(', ') || null,
          precio: precio.final,
          precioAntes: precio.descuento > 0 ? precio.original : null,
          promociones: precio.etiquetas,
          ...(business.controlaStock
            ? {
                disponible: stock > 0,
                variaciones: visibles.length,
                rangoPrecio:
                  precios.length > 1 && Math.min(...precios) !== Math.max(...precios)
                    ? `${Math.min(...precios).toFixed(2)} - ${Math.max(...precios).toFixed(2)}`
                    : null,
              }
            : {}),
          tieneFoto: Boolean(p.businessImageId),
        }
      }),
      nota: productos.length
        ? undefined
        : 'No se encontró nada con esa búsqueda. Prueba otra palabra o una categoría.',
    }
  }

  private static async verProducto(business: Business, productoId: number) {
    const p = await Product.query()
      .where('business_id', business.id)
      .andWhere('id', productoId)
      .andWhere('status', 'activo')
      .preload('categoryLinks')
      .preload('variations', (v) =>
        v.preload('attributes', (a) => a.preload('value', (val) => val.preload('attribute')))
      )
      .first()
    if (!p) return { error: 'Ese producto no existe o ya no está disponible.' }

    const promos = await PromotionService.activas(business.id)
    const categoryIds = p.categoryLinks.map((l) => l.categoryId)
    const precio = PromotionService.precioPublico(promos, p.id, categoryIds, Number(p.price))

    const base = {
      productoId: p.id,
      nombre: p.name,
      descripcion: p.description,
      precio: precio.final,
      precioAntes: precio.descuento > 0 ? precio.original : null,
      promociones: precio.etiquetas,
      tieneFoto: Boolean(p.businessImageId),
    }

    if (business.esRestaurante) {
      const reglas = await ProductModifierGroup.query()
        .where('business_id', business.id)
        .andWhere('product_id', p.id)
        .preload('group', (g) =>
          g.preload('options', (o) => o.where('is_active', true).orderBy('sort_order', 'asc'))
        )
        .orderBy('sort_order', 'asc')
      return {
        ...base,
        gruposDeOpciones: reglas
          .filter((r) => r.group?.isActive)
          .map((r) => ({
            grupo: r.group.name,
            obligatorio: r.minSelect > 0,
            eligeMinimo: r.minSelect,
            eligeMaximo: r.maxSelect,
            opciones: r.group.options.map((o) => ({
              opcionId: o.id,
              nombre: o.name,
              precioExtra: Number(o.priceDelta),
            })),
          })),
      }
    }

    return {
      ...base,
      variaciones: VariationService.visibles(p.variations).map((v) => {
        const pv = PromotionService.precioPublico(promos, p.id, categoryIds, Number(v.price), v.id)
        return {
          variacionId: v.id,
          detalle: OrderService.etiquetaVariacion(v) || 'Única',
          precio: pv.final,
          stock: Math.max(0, v.stock),
          disponible: v.stock > 0,
        }
      }),
      nota: 'Para pedir usa el variacionId de la variación que elija el cliente.',
    }
  }

  private static async enviarFoto(ctx: Contexto, productoId: number, variacionId: number | null) {
    const p = await Product.query()
      .where('business_id', ctx.business.id)
      .andWhere('id', productoId)
      .preload('businessImages')
      .preload('variations', (v) => v.preload('businessImage'))
      .first()
    if (!p) return { enviada: false, nota: 'Producto no encontrado.' }

    const variacion = variacionId ? p.variations.find((v) => v.id === variacionId) : null
    const url = variacion?.businessImage?.url ?? p.businessImages?.url ?? null
    if (!url) return { enviada: false, nota: 'Ese producto no tiene foto.' }
    if (ctx.media.length >= 4)
      return { enviada: false, nota: 'Ya enviaste varias fotos en este mensaje.' }

    const etiqueta = variacion ? OrderService.etiquetaVariacion(variacion) : ''
    ctx.media.push({ url, caption: [p.name, etiqueta].filter(Boolean).join(' · ') })
    return {
      enviada: true,
      nota: 'La foto se enviará junto con tu respuesta; no pegues el enlace.',
    }
  }

  /** Convierte los ítems que arma el modelo al formato de OrderService. */
  private static items(business: Business, crudos: any) {
    const lista = Array.isArray(crudos) ? crudos : []
    if (business.esRestaurante) {
      return lista.map((i: any) => ({
        productId: Number(i?.productoId),
        quantity: Number(i?.cantidad ?? 1),
        note: i?.nota ? String(i.nota) : null,
        options: (Array.isArray(i?.opciones) ? i.opciones : []).map((o: any) => ({
          optionId: Number(typeof o === 'object' ? o?.opcionId : o),
          quantity: Number((typeof o === 'object' && o?.cantidad) || 1),
        })),
      }))
    }
    return lista.map((i: any) => ({
      variationId: Number(i?.variacionId),
      quantity: Number(i?.cantidad ?? 1),
    }))
  }

  private static async cotizar(business: Business, args: any) {
    const items = this.items(business, args?.items) as any[]
    if (!items.length) return { error: 'No hay productos para cotizar.' }

    let entrada: { variationId?: number; productId?: number; quantity: number; extras?: number }[]
    const avisos: string[] = []

    if (business.esRestaurante) {
      const ids = items.flatMap((i) => i.options.map((o: any) => o.optionId)).filter(Boolean)
      const opciones = ids.length
        ? await ModifierOption.query().where('business_id', business.id).whereIn('id', ids)
        : []
      const porId = new Map(opciones.map((o) => [o.id, o]))
      entrada = items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        extras: i.options.reduce(
          (t: number, o: any) => t + Number(porId.get(o.optionId)?.priceDelta ?? 0) * o.quantity,
          0
        ),
      }))
    } else {
      entrada = items.map((i) => ({ variationId: i.variationId, quantity: i.quantity }))
      const productos = await Product.query()
        .where('business_id', business.id)
        .whereHas('variations', (v) =>
          v.whereIn(
            'id',
            items.map((i) => i.variationId)
          )
        )
        .preload('variations')
      for (const i of items) {
        const v = productos.flatMap((p) => p.variations).find((x) => x.id === i.variationId)
        if (!v) avisos.push(`La variación ${i.variationId} no existe.`)
        else if (v.stock < i.quantity)
          avisos.push(`Solo quedan ${Math.max(0, v.stock)} de una de las variaciones.`)
      }
    }

    const q = await PromotionService.cotizar(
      business,
      entrada,
      args?.cupon ? String(args.cupon) : null
    )
    const metodo = ['envio', 'recojo', 'mesa'].includes(args?.entrega) ? args.entrega : 'envio'
    const neto = PricingService.redondear(q.subtotal - q.descuento)
    const envio = OrderService.calcularEnvio(business, neto, metodo)

    return {
      moneda: business.currencySymbol || 'S/',
      subtotal: q.subtotal,
      descuento: q.descuento,
      envio,
      total: PricingService.redondear(neto + envio),
      promocionesAplicadas: q.lineas.map((l) => l.promo?.name).filter(Boolean),
      cupon: q.cupon,
      avisos: avisos.length ? avisos : undefined,
      nota: 'Es un estimado; crear_pedido valida todo y devuelve el total final.',
    }
  }

  private static async crearPedido(ctx: Contexto, args: any) {
    const { business } = ctx
    if (ctx.pedidoCreado) {
      return { error: `Ya se creó el pedido ${ctx.pedidoCreado.code} en esta conversación.` }
    }
    if (!business.puedeVender) {
      return { error: 'El negocio no está recibiendo pedidos ahora mismo.' }
    }

    // El teléfono es el del propio chat; si WhatsApp no lo dio (id interno), se le pide al cliente.
    const pais = (business.country as CodigoPais) ?? 'PE'
    const delChat = ctx.phone.replace(/\D/g, '')
    const telefono = !revisarTelefonoCliente(pais, delChat)
      ? delChat
      : String(args?.telefono ?? '').replace(/\D/g, '')
    if (!telefono) {
      return {
        error: 'Necesito el número de celular del cliente para registrar el pedido. Pídeselo.',
      }
    }

    const datos = {
      customerName: String(args?.nombre ?? '').trim(),
      customerPhone: telefono,
      deliveryMethod: args?.entrega,
      deliveryAddress: args?.direccion ? String(args.direccion) : null,
      deliveryCity: args?.ciudad ? String(args.ciudad) : null,
      tableLabel: args?.mesa ? String(args.mesa) : null,
      note: [args?.nota, 'Pedido tomado por el asistente de WhatsApp'].filter(Boolean).join(' · '),
      couponCode: args?.cupon ? String(args.cupon) : null,
      items: this.items(business, args?.items),
    }

    try {
      const { order } = business.esRestaurante
        ? await OrderService.crearDesdeMenu(business, datos as any, { avisarCliente: false })
        : await OrderService.crearDesdeTienda(business, datos as any)

      await OrderService.marcarEnviadoPorWhatsapp(order)
      await PanelNotificationService.pedidoNuevo(business, order)
      ctx.pedidoCreado = order

      return {
        creado: true,
        codigo: order.code,
        moneda: business.currencySymbol || 'S/',
        subtotal: Number(order.subtotal),
        descuento: Number(order.discountTotal),
        envio: Number(order.shippingCost),
        total: Number(order.total),
        productos: (order.items ?? []).map((i) => ({
          nombre: [i.productName, i.variationLabel].filter(Boolean).join(' '),
          cantidad: i.quantity,
          total: Number(i.lineTotal),
        })),
        seguimiento: NotificationService.enlaceSeguimiento(business, order),
        estado: 'pendiente de confirmación por el negocio',
        pago:
          business.paymentPolicy === 'on_confirm'
            ? `Por adelantado. ${business.paymentInstructions ?? 'Coordina el pago con el negocio.'}`
            : business.paymentPolicy === 'on_delivery'
              ? 'Contra entrega.'
              : business.paymentInstructions || 'Se coordina con el negocio.',
      }
    } catch (error) {
      if (error instanceof OrderError) return { creado: false, error: error.message }
      throw error
    }
  }

  private static async misPedidos(business: Business, phone: string) {
    const digitos = phone.replace(/\D/g, '').slice(-9)
    if (!digitos) return { pedidos: [] }
    const pedidos = await Order.query()
      .where('business_id', business.id)
      .andWhere('customer_phone', 'like', `%${digitos}`)
      .preload('items')
      .orderBy('id', 'desc')
      .limit(5)

    return {
      pedidos: pedidos.map((o) => ({
        codigo: o.code,
        estado: o.status,
        fecha: o.createdAt
          ?.setZone(env.get('REPORTS_TIMEZONE', 'America/Lima'))
          .toFormat('dd/LL/yyyy HH:mm'),
        total: Number(o.total),
        pagado: Number(o.paidTotal),
        entrega: o.deliveryMethod,
        productos: (o.items ?? []).map(
          (i) =>
            `${i.quantity} × ${i.productName}${i.variationLabel ? ` (${i.variationLabel})` : ''}`
        ),
        seguimiento: NotificationService.enlaceSeguimiento(business, o),
      })),
      nota: pedidos.length ? undefined : 'No hay pedidos con este número.',
    }
  }

  private static async derivar(ctx: Contexto, motivo: string) {
    const { business, phone } = ctx
    await this.pausar(
      business.id,
      phone,
      this.pausaHumanoMin(),
      motivo || 'Pidió hablar con una persona'
    )
    const titulo = 'Un cliente necesita atención en WhatsApp'
    const cuerpo = `${phone.replace(/\D/g, '')}: ${motivo || 'pidió hablar con una persona'}`.slice(
      0,
      250
    )
    try {
      await Notification.create({
        businessId: business.id,
        type: 'mensaje',
        orderId: null,
        title: titulo,
        body: cuerpo,
      })
      await PushService.enviar(business.userId, {
        title: titulo,
        body: cuerpo,
        url: `/b/${business.uuid}/chat`,
        tag: `wa-humano-${phone}`,
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar la derivación a humano')
    }
    return {
      derivado: true,
      nota: 'El asistente queda en silencio con este cliente hasta que el negocio lo atienda. Despídete diciendo que en breve le escribe una persona.',
    }
  }
}

const sinParametros = { type: 'object', properties: {}, additionalProperties: false }

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description:
        'Busca en el catálogo/carta del negocio por palabras clave y/o categoría. Devuelve productos con precio, promociones y disponibilidad. Úsalo siempre que el cliente pregunte qué hay, precios o si tienen algo.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description:
              'Palabras clave (ej. "polo negro", "pizza"). Vacío para ver lo más destacado.',
          },
          categoria: {
            type: 'string',
            description: 'Nombre (o parte) de una categoría, opcional.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_producto',
      description:
        'Detalle de un producto: variaciones con stock y precio (tienda) o grupos de opciones obligatorias/extras (restaurante). Úsalo antes de cotizar o pedir.',
      parameters: {
        type: 'object',
        properties: { productoId: { type: 'number' } },
        required: ['productoId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_foto_producto',
      description:
        'Envía al cliente la foto de un producto (o de una variación concreta) junto con tu respuesta.',
      parameters: {
        type: 'object',
        properties: {
          productoId: { type: 'number' },
          variacionId: {
            type: 'number',
            description: 'Opcional: foto de esa variación si tiene una propia.',
          },
        },
        required: ['productoId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cotizar_pedido',
      description:
        'Calcula subtotal, descuentos, envío y total de un carrito sin crear el pedido. Úsalo para mostrar el resumen antes de confirmar.',
      parameters: {
        type: 'object',
        properties: {
          items: ITEMS_SCHEMA(),
          entrega: { type: 'string', enum: ['envio', 'recojo', 'mesa'] },
          cupon: { type: 'string' },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_pedido',
      description:
        'Registra el pedido en el sistema del negocio. Úsalo SOLO después de que el cliente confirme el resumen. Devuelve el código, el total final y el enlace de seguimiento.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del cliente.' },
          items: ITEMS_SCHEMA(),
          entrega: { type: 'string', enum: ['envio', 'recojo', 'mesa'] },
          direccion: { type: 'string', description: 'Obligatoria si la entrega es envío.' },
          ciudad: { type: 'string' },
          mesa: { type: 'string', description: 'Obligatoria si la entrega es en mesa.' },
          nota: {
            type: 'string',
            description: 'Indicaciones del cliente (referencia, sin cebolla, etc.).',
          },
          cupon: { type: 'string' },
          telefono: {
            type: 'string',
            description: 'Solo si el sistema lo pide: celular del cliente.',
          },
        },
        required: ['nombre', 'items', 'entrega'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mis_pedidos',
      description:
        'Últimos pedidos de este cliente (por su número de WhatsApp) con estado, total y enlace de seguimiento.',
      parameters: sinParametros,
    },
  },
  {
    type: 'function',
    function: {
      name: 'derivar_a_humano',
      description:
        'Pasa la conversación a una persona del negocio y avisa al dueño. Úsalo ante reclamos, cambios o cancelaciones de pedidos, pedidos especiales o si el cliente lo pide.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', description: 'Resumen breve de lo que necesita el cliente.' },
        },
        required: ['motivo'],
        additionalProperties: false,
      },
    },
  },
]

function ITEMS_SCHEMA() {
  return {
    type: 'array',
    description:
      'Tienda: [{variacionId, cantidad}]. Restaurante: [{productoId, cantidad, opciones:[{opcionId, cantidad}], nota}].',
    items: {
      type: 'object',
      properties: {
        variacionId: { type: 'number' },
        productoId: { type: 'number' },
        cantidad: { type: 'number' },
        opciones: {
          type: 'array',
          items: {
            type: 'object',
            properties: { opcionId: { type: 'number' }, cantidad: { type: 'number' } },
            required: ['opcionId'],
          },
        },
        nota: { type: 'string' },
      },
      required: ['cantidad'],
    },
  }
}
