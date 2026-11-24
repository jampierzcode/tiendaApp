import type Business from '#models/business'
import BusinessImage from '#models/business_image'
import Category from '#models/category'
import Customer from '#models/customer'
import ModifierOption from '#models/modifier_option'
import Notification from '#models/notification'
import Order from '#models/order'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import ProductModifierGroup from '#models/product_modifier_group'
import WhatsappAgentPause from '#models/whatsapp_agent_pause'
import WhatsappMessage from '#models/whatsapp_message'
import NotificationService from '#services/notification_service'
import OrderService, { OrderError } from '#services/order_service'
import PanelNotificationService from '#services/panel_notification_service'
import PricingService from '#services/pricing_service'
import PromotionService from '#services/promotion_service'
import MenuHoyService from '#services/menu_hoy_service'
import PushService from '#services/push_service'
import VariationService from '#services/variation_service'
import Shipment from '#models/shipment'
import ShipmentService from '#services/shipment_service'
import AiUsageService from '#services/ai_usage_service'
import PaymentProofService from '#services/payment_proof_service'
import PaymentMethodService from '#services/payment_method_service'
import StorageService from '#services/storage_service'
import SellerConfigService, { type ConfigVendedor } from '#services/seller_config_service'
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
  /** Por defecto 'imagen'. Un documento (PDF…) sale como archivo adjunto. */
  tipo?: 'imagen' | 'documento'
  /** Nombre del archivo que ve el cliente (solo documentos). */
  nombre?: string
  /** Se manda DESPUÉS del texto (lo que acompaña al saludo), no como su descripción. */
  trasTexto?: boolean
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
  /** Fotos que mandó el cliente en este mensaje (para guardar comprobantes). */
  imagenes: ImagenEntrante[]
  /** Mensaje entrante de este turno (para dejar anotado en el historial lo que se hizo con su foto). */
  mensajeId: number | null
}

/** Foto que mandó el cliente, en base64 (la ve el modelo; no se guarda). */
export interface ImagenEntrante {
  mime: string
  data: string
}

type ParteUsuario =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }

type MensajeChat =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ParteUsuario[] }
  | { role: 'assistant'; content: string | null; tool_calls?: any[] }
  | { role: 'tool'; tool_call_id: string; content: string }

const MAX_VUELTAS = 6

/**
 * Último carrito cotizado por cliente. El historial solo guarda texto: sin
 * esto, en el turno siguiente el modelo ya no tiene los variacionId reales,
 * los inventa y el pedido falla («ya no está disponible»). Vive en memoria
 * (48 h): si el proceso se reinicia, el modelo vuelve a consultar el producto.
 */
interface Carrito {
  lineas: { variacionId: number; cantidad: number; detalle: string }[]
  tipoEntregaId: string | null
  total: number
  en: number
}
const CARRITOS = new Map<string, Carrito>()
const CARRITO_TTL_MS = 48 * 60 * 60 * 1000
const claveCarrito = (businessId: number, phone: string) =>
  `${businessId}|${phone.replace(/\D/g, '').slice(-9) || phone}`
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
    mensajeId: number | null,
    imagenes: ImagenEntrante[] = []
  ): Promise<RespuestaAgente | null> {
    if (!this.disponible() || !business.aiAgentEnabled) return null
    if (await this.enPausa(business.id, phone)) return null

    const cfg = SellerConfigService.config(business)
    const saludo =
      cfg.saludo.activo && cfg.saludo.texto ? this.rellenar(cfg.saludo.texto, business) : ''
    const primero = Boolean(saludo) && (await this.esPrimerMensaje(business.id, phone, mensajeId))

    // Lo que acompaña al saludo: catálogo (archivo o enlace) y fotos de productos elegidos.
    const extras = primero ? await this.extrasSaludo(business, cfg) : { enlace: '', media: [] }
    const saludoCompleto = extras.enlace ? `${saludo}\n\n${extras.enlace}` : saludo

    // Saludo exacto sin responder: sale tal cual y la pregunta se atiende en el siguiente mensaje.
    if (primero && cfg.saludo.modo === 'exacto')
      return { reply: saludoCompleto, media: extras.media }

    const ctx: Contexto = { business, phone, media: [], pedidoCreado: null, imagenes, mensajeId }
    const messages: MensajeChat[] = [
      {
        role: 'system',
        content: await this.prompt(
          business,
          phone,
          cfg,
          primero && cfg.saludo.modo === 'adaptado' ? saludoCompleto : null,
          extras.media
        ),
      },
      ...(await this.historial(business.id, phone, mensajeId)),
      {
        role: 'user',
        // Con fotos, el mensaje va en partes: el texto y cada imagen (el modelo las ve).
        content: imagenes.length
          ? [
              { type: 'text', text: texto },
              ...imagenes.map((i) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${i.mime};base64,${i.data}`, detail: 'auto' as const },
              })),
            ]
          : texto,
      },
    ]

    let final: string | null = null
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const m = await this.llamarModelo(messages, business)
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
          // Rastro de cada herramienta (qué pidió el modelo y qué recibió) para
          // poder diagnosticar conversaciones que salieron mal.
          logger.info(
            {
              business: business.id,
              contacto: phone.replace(/\D/g, '').slice(-9),
              tool: tc.function?.name,
              args: JSON.stringify(args).slice(0, 1500),
              resultado: JSON.stringify(resultado ?? null).slice(0, 1500),
            },
            'Vendedor IA: herramienta'
          )
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultado) })
        }
        continue
      }

      final = m.content?.trim() || null
      break
    }

    if (!final && !ctx.pedidoCreado) {
      // Se agotaron las vueltas con herramientas: el cliente igual recibe respuesta
      // (antes quedaba sin contestar).
      try {
        messages.push({
          role: 'user',
          content:
            '[Nota interna, no la menciones: ya no puedes usar herramientas en este turno. Responde al cliente con lo que ya sabes; si algo quedó pendiente, dile con naturalidad qué falta o qué harás.]',
        })
        const m = await this.llamarModelo(messages, business, false)
        final = m.content?.trim() || null
      } catch (error) {
        logger.error({ err: error }, 'El asistente no pudo cerrar la respuesta')
      }
    }

    if (!final && ctx.pedidoCreado) {
      // El modelo agotó las vueltas tras crear el pedido: igual se confirma.
      final = `¡Listo! Registramos tu pedido *${ctx.pedidoCreado.code}*. Síguelo aquí: ${NotificationService.enlaceSeguimiento(business, ctx.pedidoCreado)}`
    }

    let reply = final ? this.formatoWhatsapp(final) : null
    if (primero && cfg.saludo.modo === 'exacto_responde') {
      reply = reply ? `${saludoCompleto}\n\n${reply}` : saludoCompleto
    }
    return { reply, media: [...ctx.media, ...extras.media] }
  }

  /** Enlace público de la ficha de un producto en la tienda online. */
  static enlaceProducto(business: Business, p: Product) {
    const base = (env.get('STORE_PUBLIC_URL') ?? '').replace(/\/$/, '')
    return `${base}/t/${business.slug}/p/${encodeURIComponent(p.slug)}`
  }

  /** Precio «desde» de un producto (el más bajo de sus variaciones). */
  static precioDesde(p: Product) {
    const propias = (p.variations ?? []).filter((v) => !v.isDefault)
    const precios = (propias.length ? propias : (p.variations ?? [])).map((v) => Number(v.price))
    return precios.length ? Math.min(...precios) : Number(p.price)
  }

  /**
   * Documento y fotos de productos que el dueño eligió para el saludo. Van
   * después del texto, cada uno con su descripción (nombre y precio).
   */
  private static async extrasSaludo(business: Business, cfg: ConfigVendedor) {
    const media: MediaSalida[] = []
    let enlace = ''
    const doc = cfg.saludo.documento
    if (doc) {
      if (cfg.saludo.documentoComo === 'enlace') {
        enlace = `📄 ${doc.nombre}: ${doc.enlace ?? StorageService.urlAbsoluta(doc.url)}`
      } else {
        media.push({
          url: doc.url,
          tipo: 'documento',
          nombre: doc.nombre,
          caption: doc.nombre,
          trasTexto: true,
        })
      }
    }

    const ids = cfg.saludo.productos
    if (ids.length) {
      const simbolo = business.currencySymbol || 'S/'
      const promos = await PromotionService.activas(business.id)
      const productos = await Product.query()
        .where('business_id', business.id)
        .whereIn('id', ids)
        .andWhere('status', 'activo')
        .preload('businessImages')
        .preload('categoryLinks')
        .preload('variations')
      for (const id of ids) {
        const p = productos.find((x) => x.id === id)
        if (!p?.businessImages?.url) continue
        const variado =
          new Set((p.variations ?? []).filter((v) => !v.isDefault).map((v) => Number(v.price)))
            .size > 1
        const precio = PromotionService.precioPublico(
          promos,
          p.id,
          p.categoryLinks.map((l) => l.categoryId),
          this.precioDesde(p)
        ).final
        media.push({
          url: p.businessImages.url,
          caption: `*${p.name}*\n${variado ? 'Desde ' : ''}${simbolo}${Number(precio).toFixed(2)}`,
          trasTexto: true,
        })
      }
    }
    return { enlace, media }
  }

  /** ¿Es lo primero que escribe este cliente (no hay mensajes anteriores)? */
  private static async esPrimerMensaje(
    businessId: number,
    phone: string,
    excluirId: number | null
  ) {
    const previo = await WhatsappMessage.query()
      .where('business_id', businessId)
      .andWhere('contact', phone.replace(/\D/g, '').slice(-9))
      .if(excluirId, (q) => q.whereNot('id', excluirId!))
      .first()
    return !previo
  }

  private static rellenar(texto: string, business: Business) {
    const base = (env.get('STORE_PUBLIC_URL') ?? '').replace(/\/$/, '')
    return texto
      .replace(/\{\{\s*tienda\s*\}\}/gi, business.name)
      .replace(/\{\{\s*catalogo\s*\}\}/gi, `${base}/t/${business.slug}`)
  }

  // ---------------------------------------------------------------------
  // Modelo
  // ---------------------------------------------------------------------

  private static async llamarModelo(
    messages: MensajeChat[],
    business: Business,
    conHerramientas = true
  ) {
    const modelo = env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'
    // Comprobantes y envíos por agencia son de tiendas; un restaurante no los usa.
    const sinSedes = SellerConfigService.config(business).sedes.length === 0
    const tools = TOOLS.filter((t) => {
      if (
        business.esRestaurante &&
        ['registrar_comprobante', 'buscar_sedes'].includes(t.function.name)
      ) {
        return false
      }
      if (t.function.name === 'solicitar_reserva') {
        return (
          business.esRestaurante && SellerConfigService.config(business).restaurante.reservas.activo
        )
      }
      return !(sinSedes && t.function.name === 'buscar_sedes')
    })
    const base = (env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${env.get('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify({
        model: modelo,
        messages,
        tools,
        // Sin herramientas: obliga a contestar con texto (última vuelta).
        tool_choice: conHerramientas ? 'auto' : 'none',
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(45000),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      throw new Error(`OpenAI ${res.status}: ${detalle.slice(0, 300)}`)
    }
    const data: any = await res.json()
    AiUsageService.registrar(business.id, data.model ?? modelo, data.usage).catch(() => undefined)
    return data.choices?.[0]?.message ?? { content: null }
  }

  /** WhatsApp no es Markdown: negrita con un asterisco y enlaces crudos. */
  static formatoWhatsapp(texto: string) {
    return (
      texto
        // Ids internos que el modelo a veces copia al cliente: «(variacionId: 9387)».
        .replace(
          /\s*[([]?\s*(variaci[oó]nId|productoId|tipoEntregaId|opcionId)\s*[:=]\s*[\w-]+\s*[)\]]?/gi,
          ''
        )
        .replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt: string, url: string) => {
          const limpio = (txt || '').trim()
          if (!limpio || limpio === url || /^https?:\/\//i.test(limpio)) return url
          return `${limpio}: ${url}`
        })
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/^#{1,6}\s+/gm, '')
        .trim()
    )
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

  /**
   * Lo que el sistema ya sabe de este cliente: pedidos en curso y comprobantes
   * recibidos. El historial solo guarda texto, así que sin esto el modelo
   * olvida que ya registró un pago y lo vuelve a pedir.
   */
  private static async estadoCliente(business: Business, phone: string) {
    const digitos = phone.replace(/\D/g, '').slice(-9)
    if (!digitos) return ''
    const simbolo = business.currencySymbol || 'S/'
    const dinero = (n: number) => `${simbolo} ${Number(n).toFixed(2)}`

    const pedidos = await Order.query()
      .where('business_id', business.id)
      .andWhere('customer_phone', 'like', `%${digitos}`)
      .whereNotIn('status', ['cancelado', 'devuelto', 'entregado'])
      .andWhere('created_at', '>', DateTime.now().minus({ days: 7 }).toSQL()!)
      .orderBy('id', 'desc')
      .limit(3)
    const comprobantes = business.esRestaurante
      ? []
      : await PaymentProofService.recientes(business.id, [phone])

    const lineas: string[] = []
    for (const o of pedidos) {
      const saldo = PricingService.redondear(Number(o.total) - Number(o.paidTotal))
      lineas.push(
        `- Pedido ${o.code} (${o.status}): total ${dinero(Number(o.total))}, pagado y validado ${dinero(Number(o.paidTotal))}, saldo ${dinero(saldo)}.`
      )
    }
    for (const p of comprobantes) {
      const que = [
        p.amount !== null && dinero(Number(p.amount)),
        p.method,
        p.operationCode && `op. ${p.operationCode}`,
      ]
        .filter(Boolean)
        .join(' ')
      const estado = p.status === 'validado' ? 'validado por el negocio' : 'recibido, por validar'
      lineas.push(
        `- Comprobante ${que || 'de pago'} (${estado}) ${p.order ? `del pedido ${p.order.code}` : 'SIN pedido todavía: es el adelanto del pedido que están armando; al crear el pedido se asocia solo'}.`
      )
    }
    if (comprobantes.length) {
      lineas.push('- Ese pago YA LO TENEMOS: no le pidas el comprobante otra vez.')
    }
    const carrito = CARRITOS.get(claveCarrito(business.id, phone))
    if (carrito && Date.now() - carrito.en < CARRITO_TTL_MS) {
      lineas.push(
        `- ÚLTIMO CARRITO COTIZADO (aún sin pedido; para cotizar o crear el pedido usa EXACTAMENTE estos variacionId, salvo que el cliente cambie algo): ${carrito.lineas
          .map((l) => `{variacionId: ${l.variacionId}, cantidad: ${l.cantidad}} = ${l.detalle}`)
          .join(
            '; '
          )}${carrito.tipoEntregaId ? `; tipoEntregaId cotizado: ${carrito.tipoEntregaId}` : ''}; total ${dinero(carrito.total)}.`
      )
      lineas.push('- Los variacionId y demás ids son internos: nunca se los muestres al cliente.')
      const tipo = carrito.tipoEntregaId
        ? SellerConfigService.buscarTipo(business, carrito.tipoEntregaId)?.tipo
        : null
      if (tipo) {
        lineas.push(
          `- Entrega elegida: ${tipo.nombre}. Para crear el pedido SOLO se necesitan estos datos: ${tipo.datos.join(', ') || 'ninguno extra'}${/telefono|celular/i.test(normalizar(tipo.datos.join(' '))) ? ' (el teléfono ya lo tenemos por el chat)' : ''}. No pidas datos de otros tipos de entrega (si antes cotizaste otro, olvida lo que pedía ese).`
        )
      }
    }
    return lineas.join('\n')
  }

  private static async prompt(
    business: Business,
    phone: string,
    cfg: ConfigVendedor,
    saludoAdaptado: string | null,
    extrasSaludo: MediaSalida[] = []
  ) {
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

    const metodosPago = PaymentMethodService.texto(business)
    const estadoCliente = await this.estadoCliente(business, phone)
    // El celular del propio chat ya sirve para el pedido: pedirlo otra vez cansa al cliente.
    const pais = (business.country as CodigoPais) ?? 'PE'
    const celularDelChat = !revisarTelefonoCliente(pais, digitos) ? digitos : null
    const rest = cfg.restaurante
    const estado = restaurante ? SellerConfigService.estadoRestaurante(business, ahora) : null
    const bloqueRestaurante = restaurante
      ? [
          estado?.conHorario &&
            `Horario de atención: ${SellerConfigService.textoHorario(business)}.`,
          estado?.conHorario &&
            (estado.abierto
              ? `AHORA ESTÁ ABIERTO${estado.hoy ? ` (hoy ${estado.hoy})` : ''}.`
              : `AHORA ESTÁ CERRADO. Abre ${estado.proximo || 'pronto'}. ${rest.mensajeCerrado ? `Dilo así: «${rest.mensajeCerrado}». ` : ''}${rest.programados ? 'Puedes tomar el pedido como PROGRAMADO para cuando abra: avísale que se prepara al abrir.' : 'NO tomes pedidos hasta que abra; puedes mostrarle la carta y resolver dudas.'}`),
          rest.prepMin &&
            `Tiempo de preparación aproximado: ${rest.prepMin} minutos (para recojo o mesa).`,
          rest.sugerencias &&
            `SUGERENCIAS PARA SUBIR EL PEDIDO (una sola vez, antes de cerrar, sin insistir): ${rest.sugerencias}`,
          rest.reservas.activo
            ? `RESERVAS: sí se aceptan. Pide nombre, número de personas, fecha y hora, y usa "solicitar_reserva"; dile que el restaurante la confirma.${rest.reservas.instrucciones ? ` Reglas: ${rest.reservas.instrucciones}` : ''}`
            : 'RESERVAS: no se toman por este medio; si preguntan, deriva a una persona.',
        ]
          .filter(Boolean)
          .join('\n')
      : ''
    const textoZonas = SellerConfigService.textoEnvios(business, ahora)
    const conZonas = Boolean(textoZonas)

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
      !conZonas &&
        `Envío a domicilio: ${envio}. También se puede recoger en el local${restaurante ? ' o pedir en mesa' : ''}.`,
      !conZonas && `Pago: ${politica}`,
      metodosPago &&
        `Métodos de pago (los únicos válidos; nunca des otro número ni el WhatsApp de la tienda para pagar):\n${metodosPago}`,
      PaymentMethodService.textoLibre(business) &&
        `Cómo pagar: ${PaymentMethodService.textoLibre(business)}`,
      categorias.length && `Categorías: ${categorias.map((c) => c.name).join(', ')}`,
      !business.puedeVender &&
        'IMPORTANTE: ahora mismo el negocio NO está recibiendo pedidos. Informa y no crees pedidos.',
    ]
      .filter(Boolean)
      .join('\n')

    const instrucciones = business.aiAgentInstructions?.trim()

    const tono = {
      amigable: 'amable, cálido y cercano',
      profesional: 'profesional, claro y seguro',
      divertido: 'alegre y con chispa, sin perder el respeto',
      formal: 'formal y cortés',
    }[cfg.tono]
    const emojis = {
      ninguno: 'No uses emojis.',
      pocos: 'Emojis con moderación (máximo 1 o 2 por mensaje).',
      muchos: 'Usa emojis con naturalidad para dar calidez.',
    }[cfg.emojis]
    const fotos = {
      siempre:
        'Cada vez que muestres, recomiendes o el cliente pregunte por un producto concreto, envía su foto con "enviar_foto_producto" (hasta 3 por respuesta). Vender con foto vende más.',
      cuando_ayude:
        'Si el producto tiene foto y ayuda a vender, envíala con "enviar_foto_producto".',
      nunca: 'No envíes fotos salvo que el cliente las pida expresamente.',
    }[cfg.fotos]

    const faqs = cfg.faqs.filter((f) => f.activa).slice(0, 60)
    const textoFaqs = faqs
      .map((f) => `- [${f.categoria}] P: ${f.pregunta}\n  R: ${f.respuesta}`)
      .join('\n')

    const personalidad = [
      cfg.nombre
        ? `Te llamas ${cfg.nombre} y eres del equipo de "${business.name}".`
        : `Eres del equipo de "${business.name}".`,
      `Tu tono es ${tono}. Trata al cliente de ${cfg.trato === 'usted' ? 'USTED' : 'TÚ'}.`,
      cfg.publico && `Le vendes a: ${cfg.publico}. Adapta tu forma de hablar a ese público.`,
      emojis,
      cfg.largo === 'corto'
        ? 'Respuestas CORTAS: 1 a 4 líneas.'
        : 'Respuestas de largo medio: hasta 6-7 líneas si hace falta.',
      cfg.palabrasEvitar && `Nunca uses estas palabras o expresiones: ${cfg.palabrasEvitar}.`,
    ]
      .filter(Boolean)
      .join('\n')

    return `Eres el vendedor de "${business.name}" y atiendes por WhatsApp. Hablas como una persona real del negocio: natural, cercana y en el español del cliente (por defecto, español peruano). Nada de menús rígidos ni respuestas de robot. Nunca digas que eres una IA salvo que te lo pregunten directamente.

PERSONALIDAD
${personalidad}
${saludoAdaptado ? `\nEs el PRIMER mensaje de este cliente: salúdalo con este saludo, dicho con tus palabras (mantén la información y los enlaces), y luego responde lo que haya preguntado:\n«${saludoAdaptado}»\n` : ''}${extrasSaludo.length ? `\nJunto con tu saludo se enviarán solos: ${extrasSaludo.map((m) => (m.tipo === 'documento' ? `el documento «${m.nombre}»` : `la foto de ${m.caption?.split('\n')[0].replace(/\*/g, '')}`)).join(', ')}. Puedes mencionarlos («te dejo nuestro catálogo y algunos favoritos»), pero no los vuelvas a enviar.\n` : ''}
Fecha y hora actual: ${ahora.toFormat("cccc d 'de' LLLL yyyy, HH:mm")}.
${cliente ? `Este cliente ya compró antes: se llama ${cliente.name}${cliente.address ? `, su última dirección fue ${[cliente.address, cliente.city].filter(Boolean).join(', ')}` : ''}. Llámale por su nombre y confirma si la dirección sigue igual antes de usarla.` : 'Es un cliente nuevo o no lo tenemos registrado.'}
${celularDelChat ? `Su celular es el de este chat (${celularDelChat}): ya lo tenemos y se guarda solo en el pedido. NO se lo pidas, aunque el tipo de entrega pida "Teléfono"; solo si quiere dar otro número de contacto, pásalo en datosCliente.` : 'No tenemos su número de celular (WhatsApp no lo dio): pídeselo para el pedido.'}
${estadoCliente ? `\nESTADO DE ESTE CLIENTE (datos reales del sistema, más confiables que la conversación)\n${estadoCliente}\n` : ''}
DATOS DEL NEGOCIO
${datos}
${bloqueRestaurante ? `\nRESTAURANTE\n${bloqueRestaurante}\n` : ''}${
      conZonas
        ? `\nENVÍOS Y ENTREGAS (zonas y tipos de entrega del negocio)\n${textoZonas}\n- Pregunta en qué distrito / ciudad está el cliente y busca su zona en la lista. Ofrécele SOLO los tipos de entrega de su zona, con costo, plazo ("si pide ahora…") y forma de pago. Si su lugar no está en ninguna zona, dile con amabilidad que no llegan ahí y usa "derivar_a_humano" si insiste.\n- Cuando elija, usa su tipoEntregaId en "cotizar_pedido" y "crear_pedido".\n- Si el pago es adelantado (total o parcial), di cuánto debe adelantar, cómo pagar y pídele la captura del comprobante. Lo ideal es crear el pedido y luego pedir el adelanto; pero si el cliente paga ANTES de que exista el pedido, ese pago es el adelanto de este pedido: regístralo y crea el pedido apenas tengas lo necesario (el comprobante se asocia solo). El negocio valida el pago.\n- "Agencia de recojo" es la sede concreta (nombre o dirección, p. ej. la que diga el cliente), NO la ciudad ni solo el nombre de la empresa. Si el cliente da o corrige un dato después de creado el pedido, usa "corregir_pedido".
- La agencia de recojo, la dirección y la referencia son las que el cliente escribió: no las deduzcas de mensajes ambiguos ni las inventes; si no está claro, pregúntale antes de crear el pedido.
- Pide los "Datos que DEBES pedir" del tipo elegido que AÚN NO te haya dado (revisa la conversación: nunca pidas dos veces un dato que ya dio, como su DNI o su nombre), de a pocos y de forma natural, y pásalos en "datosCliente" al crear el pedido. Si cambia de zona o de tipo de entrega, vuelve a cotizar con el nuevo tipoEntregaId.\n`
        : ''
    }${textoFaqs ? `\nPREGUNTAS FRECUENTES (respóndelas con esta información; consúltalas antes de decir que no sabes algo)\n${textoFaqs}\n` : ''}${cfg.descuentos ? `\nDESCUENTOS PERMITIDOS POR EL DUEÑO\n${cfg.descuentos}\n` : ''}${cfg.derivarCuando.length ? `\nDERIVA A UNA PERSONA ("derivar_a_humano") EN ESTAS SITUACIONES\n${cfg.derivarCuando.map((d) => `- ${d}`).join('\n')}\n` : ''}${instrucciones ? `\nINDICACIONES DEL DUEÑO (síguelas siempre que no contradigan las reglas de abajo)\n${instrucciones}\n` : ''}${cfg.ejemplo ? `\nEJEMPLO DE CÓMO QUIERE EL DUEÑO QUE VENDAS (imita el estilo, el orden y la forma de cerrar; los datos reales salen de las herramientas y de lo de arriba, no del ejemplo)\n-----\n${cfg.ejemplo}\n-----\n` : ''}
TU OBJETIVO
Ayudar al cliente a encontrar lo que busca y cerrar la venta registrando su pedido. Recomienda, resuelve dudas y sugiere un complemento cuando tenga sentido, sin presionar.

CÓMO TRABAJAS
- Para precios, disponibilidad, stock, opciones o pedidos USA LAS HERRAMIENTAS. Nunca inventes productos, precios, stock, promociones, plazos ni datos que no estén arriba o que no devuelva una herramienta. Tampoco inventes sedes, agencias ni direcciones (de Shalom, Olva u otras): solo las que devuelva "buscar_sedes" o las que diga el cliente.
- Busca con "buscar_productos" (palabras clave cortas, en singular: "polo", "hamburguesa"). Si no aparece, prueba con sinónimos antes de decir que no hay.
- Antes de pedir, revisa el producto con "ver_producto" para conocer ${restaurante ? 'sus opciones obligatorias (p. ej. término, guarnición) y pregúntale al cliente las que falten' : 'sus variaciones (talla, color…) y su stock, y pregúntale al cliente cuál quiere'}.
- FOTOS: ${fotos} Tu respuesta de texto se mandará como descripción de la última foto (en el mismo mensaje), así que escríbela pensando en eso: no digas "te envío la foto", simplemente describe y vende.
- Para cerrar el pedido necesitas: productos y cantidades${restaurante ? ' (con sus opciones)' : ' (con la variación exacta)'}, el nombre del cliente y la forma de entrega (${conZonas ? 'el tipo de entrega de su zona y los datos que ese tipo pide' : `envío con dirección, recojo${restaurante ? ', o mesa con su número' : ''}`}). Pídelo de forma natural, de a pocos.
${
  restaurante
    ? `- Flujo de restaurante: saluda y ofrece la carta (enlace o fotos de los platos que pregunte); toma el pedido plato por plato con sus opciones obligatorias; pregunta la modalidad (delivery con dirección y referencia, recojo en local${conZonas ? '' : ''} o mesa con su número); confirma el resumen con el total y el tiempo estimado; luego registra el pedido. Habla de minutos, no de días.`
    : '- Si el cliente quiere separar o reservar un producto, es lo mismo que un pedido: cotiza, confirma y créalo; luego explica el adelanto si corresponde.'
}
${
  restaurante
    ? ''
    : `- En "cotizar_pedido" y "crear_pedido" cada línea lleva el variacionId que devuelve "ver_producto" (NO el productoId). Si no lo tienes a mano, manda productoId + detalle (p. ej. "Negro", "Talla M") y el sistema la busca. Para varios colores, una línea por color.
- STOCK: si "ver_producto" dice stock "ilimitado" o disponible: true, SÍ hay; nunca digas que no hay stock de eso. Si una herramienta responde que una variación no existe o falta elegirla, es un dato mal pasado tuyo: corrígelo (revisa "ver_producto" y usa el id correcto) sin decirle al cliente que el producto no está disponible.
`
}- Antes de crear el pedido usa "cotizar_pedido" y muéstrale un resumen corto con el total real (incluye envío y descuentos). Créalo con "crear_pedido" SOLO cuando el cliente confirme ("sí", "dale", "confirmo"…).
- Tras crear el pedido, dale el código, el total y el enlace de seguimiento; si el pago es por adelantado, explica cómo pagar con los métodos de pago de arriba (lista los activos con su número y titular) y pídele que mande la foto del comprobante. Los QR marcados «al confirmar» se envían solos con tu respuesta; si pide el QR de otro método, usa "enviar_qr_pago".
- ENLACES DE PRODUCTO: si el cliente pide el link, la página o "dónde lo veo" de un producto, pásale el "enlace" de ese producto (viene en "buscar_productos" y "ver_producto"). El enlace del catálogo es solo para ver la tienda completa: no lo uses cuando pregunta por un producto concreto. Nunca armes enlaces a mano.
- RESPUESTAS A UN MENSAJE: si el texto del cliente empieza con "[El cliente responde a tu foto: «…»]" (o a un mensaje o a una foto), se refiere a ESE producto o mensaje. "Este", "ese", "lo quiero", "¿precio?", "¿hay en M?" hablan de él: búscalo por su nombre con "buscar_productos"/"ver_producto" y sigue con él, sin preguntarle cuál es. Si le enviaste varias fotos y responde sin citar ninguna, pregúntale cuál le gustó.
- Si pregunta por un pedido que ya hizo, usa "mis_pedidos".
- Si el cliente manda una foto, MÍRALA y actúa según lo que sea:
  · Captura o foto de un producto (de esta tienda u otra): identifica qué es (nombre, tipo, color) y búscalo con "buscar_productos" para darle precio y disponibilidad reales.
  · Comprobante de pago (captura de Yape, Plin, transferencia o voucher): léelo (monto, método, número de operación, fecha, titular) y usa SIEMPRE "registrar_comprobante", aunque el pedido aún no exista. Dile que lo recibiste y que el negocio lo valida en breve; nunca digas que el pago ya está confirmado. Si aún no hay pedido y el cliente ya eligió productos y entrega y tienes sus datos, crea el pedido en ESTA MISMA respuesta (cotizar_pedido y crear_pedido) y dale el código; si falta algo, pide solo eso.
  · Mensajes cortos que acompañan una foto ("ahí está", "ayi está", "listo", "ya te mandé") se refieren a la foto: no son un nombre, una agencia ni una dirección.
  · Un comprobante que ya registraste (o que figura en ESTADO DE ESTE CLIENTE) NUNCA se vuelve a pedir, aunque en el mensaje actual no venga foto. Si una herramienta falla, el problema no es el comprobante: no le pidas la foto otra vez.
  · Una foto de producto, de un DNI o de una agencia NO es un comprobante: no uses "registrar_comprobante" con eso.
  · Otra cosa (foto de referencia, ubicación, problema con un producto): responde según corresponda; si es un reclamo, usa "derivar_a_humano".
- PRECIOS: nunca rebajes ni inventes descuentos por tu cuenta. Si el cliente regatea ("¿nada menos?", "¿me lo dejas en…?"), responde con amabilidad que el precio es el publicado, menciona las promociones o cupones vigentes si los hay, y resalta el valor del producto. Solo da un descuento si las indicaciones del dueño lo permiten. Si insiste mucho, ofrécele consultarlo con el negocio usando "derivar_a_humano".
- Si pide hablar con una persona, tiene un reclamo, quiere cambiar o cancelar un pedido ya hecho, pide algo que no puedes resolver o se molesta, usa "derivar_a_humano" y avísale que en breve lo atienden.
- Si el mensaje no tiene nada que ver con el negocio, responde con amabilidad y redirige con suavidad.

FORMATO (WhatsApp, no Markdown)
- Una sola pregunta a la vez. Si das opciones, enuméralas en una lista corta.
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
          args?.variacionId ? Number(args.variacionId) : null,
          Math.min(3, Math.max(1, Number(args?.cuantas ?? 1) || 1)),
          args?.preguntaNumero ? Number(args.preguntaNumero) : null
        )
      case 'cotizar_pedido': {
        const r: any = await this.cotizar(ctx.business, args)
        if (!r?.error && r?.lineas) {
          for (const [k, c] of CARRITOS) if (Date.now() - c.en > CARRITO_TTL_MS) CARRITOS.delete(k)
          CARRITOS.set(claveCarrito(ctx.business.id, ctx.phone), {
            lineas: r.lineas,
            tipoEntregaId: args?.tipoEntregaId ? String(args.tipoEntregaId) : null,
            total: Number(r.total),
            en: Date.now(),
          })
        }
        return r
      }
      case 'crear_pedido':
        return this.crearPedido(ctx, args)
      case 'mis_pedidos':
        return this.misPedidos(ctx.business, ctx.phone)
      case 'solicitar_reserva':
        return this.solicitarReserva(ctx, args)
      case 'enviar_qr_pago': {
        const metodo = PaymentMethodService.activos(ctx.business).find(
          (m) => m.id === String(args?.metodoId ?? '')
        )
        if (!metodo?.imagenes.length)
          return { enviada: false, nota: 'Ese método no tiene QR o imagen.' }
        for (const i of metodo.imagenes) {
          if (ctx.media.length < 4)
            ctx.media.push({ url: StorageService.urlAbsoluta(i.url)!, caption: metodo.nombre })
        }
        return { enviada: true, nota: 'El QR se enviará con tu respuesta; no pegues enlaces.' }
      }
      case 'buscar_sedes': {
        const r = SellerConfigService.buscarSedes(
          ctx.business,
          String(args?.empresa ?? ''),
          String(args?.lugar ?? '')
        )
        return {
          sedes: r.sedes.map((x) => ({
            nombre: x.nombre,
            direccion: x.direccion,
            lugar: [x.distrito, x.provincia, x.departamento].filter(Boolean).join(', '),
            referencia: x.referencia || undefined,
          })),
          nota: r.sedes.length
            ? 'Muéstrale estas opciones numeradas (nombre y dirección) y pregúntale en cuál recoge. Guarda la elegida en datosCliente["Agencia de recojo"] con nombre y dirección.'
            : r.total
              ? 'No hay sedes cargadas en ese lugar, pero igual se puede enviar a cualquier agencia de esa empresa: pregúntale en qué agencia de su ciudad quiere recoger (nombre o dirección) y guárdala tal cual. Si tiene dudas, puedes ofrecerle las sedes cargadas de la ciudad más cercana. NO inventes direcciones.'
              : 'Esta empresa no tiene sedes cargadas: pídele al cliente el nombre o la dirección de la agencia donde quiere recoger.',
        }
      }
      case 'registrar_comprobante':
        return this.registrarComprobante(ctx, args)
      case 'corregir_pedido':
        return this.corregirPedido(ctx, args)
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

    // Lo que hoy no hay (fuera del Menú del día o agotado) no se ofrece.
    const disp = await MenuHoyService.disponibilidad(business.id)
    const consultar = (modo: 'todas' | 'alguna') => {
      const q = Product.query()
        .where('business_id', business.id)
        .andWhere('status', 'activo')
        .whereNotIn('products.id', [...disp.ocultos, ...disp.agotados])
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
        const stock = p.unlimitedStock
          ? Number.POSITIVE_INFINITY
          : visibles.reduce((t, v) => t + Math.max(0, v.stock), 0)
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
          enlace: this.enlaceProducto(business, p),
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
    const disp = await MenuHoyService.disponibilidad(business.id)
    if (disp.agotados.has(p.id) || disp.ocultos.has(p.id)) {
      return { error: `Hoy no hay ${p.name}. Ofrece otra opción de la carta.` }
    }

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
      enlace: this.enlaceProducto(business, p),
      // Respuestas que el dueño dejó para este producto: úsalas tal cual.
      preguntasFrecuentes: p.aiFaqs?.length
        ? p.aiFaqs.map((f, i) => ({
            numero: i + 1,
            pregunta: f.pregunta,
            respuesta: f.respuesta,
            ...(f.imagenId
              ? {
                  tieneFoto: true,
                  nota: `Al responder esta, envía su foto: enviar_foto_producto con preguntaNumero ${i + 1}.`,
                }
              : {}),
          }))
        : undefined,
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
          stock: p.unlimitedStock ? 'ilimitado' : Math.max(0, v.stock),
          disponible: p.unlimitedStock || v.stock > 0,
        }
      }),
      nota: 'Para pedir usa el variacionId de la variación que elija el cliente.',
    }
  }

  private static async enviarFoto(
    ctx: Contexto,
    productoId: number,
    variacionId: number | null,
    cuantas = 1,
    preguntaNumero: number | null = null
  ) {
    const p = await Product.query()
      .where('business_id', ctx.business.id)
      .andWhere('id', productoId)
      .preload('businessImages')
      .preload('variations', (v) => v.preload('businessImage'))
      .preload('gallery', (g) =>
        g.preload('image').orderBy('sort_order', 'asc').orderBy('id', 'asc')
      )
      .first()
    if (!p) return { enviada: false, nota: 'Producto no encontrado.' }

    // Foto de una pregunta frecuente (p. ej. «¿cómo se ve puesto?»).
    if (preguntaNumero) {
      const faq = p.aiFaqs?.[preguntaNumero - 1]
      const foto = faq?.imagenId
        ? await BusinessImage.query()
            .where('business_id', ctx.business.id)
            .andWhere('id', faq.imagenId)
            .first()
        : null
      if (!foto) return { enviada: false, nota: 'Esa pregunta no tiene foto.' }
      if (ctx.media.length >= 4)
        return { enviada: false, nota: 'Ya enviaste varias fotos en este mensaje.' }
      ctx.media.push({ url: foto.url, caption: p.name })
      return {
        enviadas: 1,
        nota: 'La foto se enviará junto con tu respuesta; no pegues la URL de la foto.',
      }
    }

    const variacion = variacionId ? p.variations.find((v) => v.id === variacionId) : null
    const de = (principal: string | null | undefined, vid: number | null) =>
      [
        principal,
        ...p.gallery.filter((g) => g.productVariationId === vid).map((g) => g.image?.url),
      ].filter((u): u is string => Boolean(u))
    let urls = variacion ? de(variacion.businessImage?.url, variacion.id) : []
    if (!urls.length) urls = de(p.businessImages?.url, null)
    urls = [...new Set(urls)]
    if (!urls.length) return { enviada: false, nota: 'Ese producto no tiene foto.' }

    const libres = 4 - ctx.media.length
    if (libres <= 0) return { enviada: false, nota: 'Ya enviaste varias fotos en este mensaje.' }

    const etiqueta = variacion ? OrderService.etiquetaVariacion(variacion) : ''
    const caption = [p.name, etiqueta].filter(Boolean).join(' · ')
    const elegidas = urls.slice(0, Math.min(cuantas, libres))
    for (const url of elegidas) ctx.media.push({ url, caption })
    return {
      enviadas: elegidas.length,
      fotosDisponibles: urls.length,
      nota: 'Las fotos se enviarán junto con tu respuesta; no pegues la URL de las fotos.',
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

  /**
   * Tienda: deja cada línea con un variacionId real. El modelo a veces manda el
   * productoId (o lo pone en variacionId) y el pedido fallaba con «ya no está
   * disponible», que el modelo traducía como «no hay stock». Si el producto
   * tiene una sola variación o el detalle («Negro») la identifica, se resuelve aquí.
   */
  private static async resolverItems(business: Business, crudos: any) {
    if (business.esRestaurante) {
      return { items: this.items(business, crudos) as any[], errores: [] as string[] }
    }
    const lista: any[] = Array.isArray(crudos) ? crudos : []
    const items: { variationId: number; quantity: number; detalle: string }[] = []
    const errores: string[] = []
    const etiqueta = (v: ProductVariation) => OrderService.etiquetaVariacion(v) || 'Única'
    const conAtributos = (q: any) =>
      q.preload('attributes', (a: any) =>
        a.preload('value', (val: any) => val.preload('attribute'))
      )
    const RELLENO = new Set(['de', 'del', 'la', 'el', 'en', 'y', 'color', 'talla', 'modelo'])

    for (const [n, crudo] of lista.entries()) {
      const quantity = Number(crudo?.cantidad ?? 1)
      const vid = Number(crudo?.variacionId)
      const pid = Number(crudo?.productoId)
      const detalle = String(crudo?.detalle ?? '').trim()

      if (Number.isFinite(vid) && vid > 0) {
        const v = await ProductVariation.query()
          .where('business_id', business.id)
          .andWhere('id', vid)
          .preload('product')
          .if(true, conAtributos)
          .first()
        if (v && !(pid > 0 && v.productId !== pid)) {
          items.push({
            variationId: v.id,
            quantity,
            detalle: `${v.product?.name ?? ''} ${etiqueta(v)}`.trim(),
          })
          continue
        }
      }

      const productoId = pid > 0 ? pid : vid
      const p =
        Number.isFinite(productoId) && productoId > 0
          ? await Product.query()
              .where('business_id', business.id)
              .andWhere('id', productoId)
              .andWhere('status', 'activo')
              .preload('variations', (q) =>
                q.preload('attributes', (a) =>
                  a.preload('value', (val) => val.preload('attribute'))
                )
              )
              .first()
          : null
      if (!p) {
        errores.push(
          `Línea ${n + 1}: no encontré ese producto ni esa variación (no inventes ids: usa los de "ver_producto" o los del ÚLTIMO CARRITO COTIZADO) (variacionId ${crudo?.variacionId ?? '—'}, productoId ${crudo?.productoId ?? '—'}). Búscalo con "buscar_productos" y mira sus variaciones con "ver_producto".`
        )
        continue
      }

      const visibles = VariationService.visibles(p.variations)
      let elegida = visibles.length === 1 ? visibles[0] : null
      if (!elegida && detalle) {
        const palabras = normalizar(detalle)
          .split(/[^a-z0-9]+/)
          .filter((w) => w && !RELLENO.has(w))
        const coinciden = visibles.filter((v) => {
          const e = ` ${normalizar(etiqueta(v)).replace(/[^a-z0-9]+/g, ' ')} `
          return palabras.length > 0 && palabras.every((w) => e.includes(` ${w} `))
        })
        // Dos variaciones con la misma etiqueta (p. ej. «Negro» cargado dos veces): da igual cuál.
        if (coinciden.length && new Set(coinciden.map(etiqueta)).size === 1) elegida = coinciden[0]
      }
      if (elegida) {
        items.push({ variationId: elegida.id, quantity, detalle: `${p.name} ${etiqueta(elegida)}` })
        continue
      }
      errores.push(
        `Línea ${n + 1} («${p.name}»): falta elegir la variación${detalle ? ` (no reconocí «${detalle}»)` : ''}. Opciones (variacionId = detalle): ${visibles
          .slice(0, 30)
          .map((v) => `${v.id} = ${etiqueta(v)}`)
          .join(
            '; '
          )}. Esto NO significa que falte stock: vuelve a llamar con el variacionId correcto.`
      )
    }
    return { items, errores }
  }

  private static async cotizar(business: Business, args: any) {
    const resueltos = await this.resolverItems(business, args?.items)
    if (resueltos.errores.length) return { error: resueltos.errores.join(' ') }
    const items = resueltos.items as any[]
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
        else if (
          !productos.find((p) => p.id === v.productId)?.unlimitedStock &&
          v.stock < i.quantity
        )
          avisos.push(`Solo quedan ${Math.max(0, v.stock)} de una de las variaciones.`)
      }
    }

    const q = await PromotionService.cotizar(
      business,
      entrada,
      args?.cupon ? String(args.cupon) : null
    )
    const neto = PricingService.redondear(q.subtotal - q.descuento)
    const entrega = this.entrega(business, args, neto)
    if ('error' in entrega) return entrega
    const total = PricingService.redondear(neto + entrega.envio)

    return {
      moneda: business.currencySymbol || 'S/',
      subtotal: q.subtotal,
      descuento: q.descuento,
      envio: entrega.envio,
      envioDetalle: entrega.detalle,
      total,
      ...(entrega.tipo
        ? {
            tipoEntrega: entrega.tipo.nombre,
            llega: entrega.promesa,
            pago: SellerConfigService.textoPago(entrega.tipo, business.currencySymbol || 'S/'),
            adelantoMinimo: SellerConfigService.adelanto(entrega.tipo, total),
            datosQueDebesPedir: entrega.tipo.datos,
            ...(entrega.tipo.minimo && neto < entrega.tipo.minimo
              ? { faltaParaMinimo: PricingService.redondear(entrega.tipo.minimo - neto) }
              : {}),
          }
        : {}),
      promocionesAplicadas: q.lineas.map((l) => l.promo?.name).filter(Boolean),
      cupon: q.cupon,
      ...(business.esRestaurante
        ? {}
        : {
            lineas: items.map((i: any) => ({
              variacionId: i.variationId,
              cantidad: i.quantity,
              detalle: i.detalle,
            })),
          }),
      avisos: avisos.length ? avisos : undefined,
      nota: 'Es un estimado; crear_pedido valida todo y devuelve el total final.',
    }
  }

  /**
   * Resuelve la entrega: con zonas configuradas, el tipo elegido manda el
   * costo; sin zonas, el envío general del negocio.
   */
  private static entrega(business: Business, args: any, neto: number) {
    const simbolo = business.currencySymbol || 'S/'
    const conZonas = SellerConfigService.activas(business).length > 0
    // Mesa (restaurante) y recojo en el local no necesitan zona.
    if (conZonas && !args?.tipoEntregaId && ['mesa', 'recojo'].includes(args?.entrega)) {
      const metodo = args.entrega as 'mesa' | 'recojo'
      return {
        metodo,
        envio: 0,
        detalle: metodo === 'mesa' ? 'En mesa' : 'Recojo en el local, sin costo',
        tipo: null,
        zona: null,
        promesa: null,
      }
    }
    if (conZonas) {
      const hallado = args?.tipoEntregaId
        ? SellerConfigService.buscarTipo(business, String(args.tipoEntregaId))
        : null
      if (!hallado) {
        return {
          error:
            'Falta el tipoEntregaId: pregunta al cliente dónde está, ofrécele los tipos de entrega de su zona y usa el id del que elija.',
        }
      }
      const costo = SellerConfigService.costo(hallado.tipo, neto, simbolo)
      const zona = env.get('REPORTS_TIMEZONE', 'America/Lima')
      return {
        metodo: hallado.tipo.clase === 'recojo' ? ('recojo' as const) : ('envio' as const),
        envio: costo.monto,
        detalle: costo.detalle,
        tipo: hallado.tipo,
        zona: hallado.zona,
        promesa: SellerConfigService.promesaAhora(hallado.tipo, DateTime.now().setZone(zona)),
      }
    }
    const metodo = ['envio', 'recojo', 'mesa'].includes(args?.entrega) ? args.entrega : 'envio'
    const envio = OrderService.calcularEnvio(business, neto, metodo)
    return {
      metodo: metodo as 'envio' | 'recojo' | 'mesa',
      envio,
      detalle: envio ? `${simbolo} ${envio.toFixed(2)}` : 'Sin costo',
      tipo: null,
      zona: null,
      promesa: null,
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

    // Mismo pedido dos veces: el cliente responde «sí» a un resumen repetido y
    // el modelo vuelve a crearlo. Se frena si hay uno reciente con los mismos productos.
    if (!business.esRestaurante && !args?.pedidoAdicional) {
      const { items: nuevos } = await this.resolverItems(business, args?.items)
      const firma = (l: { id: number | null; q: number }[]) =>
        l
          .map((x) => `${x.id}x${x.q}`)
          .sort()
          .join(',')
      const buscada = firma(nuevos.map((i) => ({ id: i.variationId, q: i.quantity })))
      const recientes = await Order.query()
        .where('business_id', business.id)
        .andWhere('customer_phone', 'like', `%${telefono.slice(-9)}`)
        .whereNotIn('status', ['cancelado', 'devuelto'])
        .andWhere('created_at', '>', DateTime.now().minus({ hours: 12 }).toSQL()!)
        .preload('items')
      const igual = recientes.find(
        (o) =>
          firma(o.items.map((i) => ({ id: i.productVariationId, q: Number(i.quantity) }))) ===
          buscada
      )
      if (igual) {
        return {
          creado: false,
          yaExiste: igual.code,
          error: `Ese pedido YA está creado: ${igual.code}. No lo crees otra vez. Si el cliente da o corrige un dato, usa "corregir_pedido"; dale el código y el seguimiento (${NotificationService.enlaceSeguimiento(business, igual)}). Solo si el cliente pide claramente OTRO pedido igual aparte, vuelve a llamar con pedidoAdicional: true.`,
        }
      }
    }

    // El costo de envío depende del monto: se calcula con una cotización previa.
    const { items: lineasPedido } = await this.resolverItems(business, args?.items)
    const cot: any = await this.cotizar(business, args)
    if (cot?.error) return { creado: false, error: cot.error }
    const neto = PricingService.redondear(Number(cot.subtotal) - Number(cot.descuento))
    const entrega = this.entrega(business, args, neto)
    if ('error' in entrega) return { creado: false, error: entrega.error }

    // Restaurante cerrado: solo pedidos programados si el dueño lo permite.
    let programado = false
    if (business.esRestaurante) {
      const zona = env.get('REPORTS_TIMEZONE', 'America/Lima')
      const est = SellerConfigService.estadoRestaurante(business, DateTime.now().setZone(zona))
      if (!est.abierto) {
        if (!SellerConfigService.config(business).restaurante.programados) {
          return {
            creado: false,
            error: `El restaurante está cerrado ahora (abre ${est.proximo || 'pronto'}). No registres el pedido; invítalo a pedir cuando abra.`,
          }
        }
        programado = true
      }
    }

    // Pedido mínimo del tipo de entrega elegido.
    if (entrega.tipo?.minimo && neto + 0.001 < entrega.tipo.minimo) {
      const sim = business.currencySymbol || 'S/'
      return {
        creado: false,
        error: `El pedido mínimo para ${entrega.tipo.nombre} es ${sim} ${entrega.tipo.minimo.toFixed(2)} y lleva ${sim} ${neto.toFixed(2)}. Sugiérele agregar algo más.`,
      }
    }

    // Datos obligatorios del tipo de entrega: sin ellos no se cierra.
    const extra: Record<string, string> = {}
    const norm = (t: string) =>
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    for (const [k, v] of Object.entries(args?.datosCliente ?? {})) {
      const valor = String(v ?? '').trim()
      // «Referencia: Referencia», «DNI: -»: el modelo rellenó el campo sin que el cliente lo diera.
      if (
        !valor ||
        norm(valor) === norm(k.trim()) ||
        /^[-_.\s?]*$|^(n\/?a|ninguno|ninguna|no aplica|pendiente)$/i.test(valor)
      )
        continue
      extra[k.trim()] = valor.slice(0, 300)
    }
    // Envío por agencia: el modelo suele poner la agencia en «direccion» y el
    // pedido se rechazaba pidiendo un dato que el cliente ya había dado.
    const direccionDada = String(args?.direccion ?? '').trim()
    if (
      entrega.tipo?.clase === 'agencia' &&
      direccionDada &&
      !Object.keys(extra).some((k) => /agencia/.test(norm(k)))
    ) {
      extra['Agencia de recojo'] = direccionDada.slice(0, 300)
    }
    // «Shalom» a secas no dice en qué sede recoge: el dueño no podría despachar.
    if (entrega.tipo?.clase === 'agencia') {
      const clave = Object.keys(extra).find((k) => /agencia/.test(norm(k)))
      const empresa = norm(entrega.tipo.nombre)
      const resto = clave
        ? norm(extra[clave])
            .split(/[^a-z0-9]+/)
            .filter(
              (w) =>
                w &&
                !empresa.includes(w) &&
                !['agencia', 'sede', 'de', 'la', 'el', 'en'].includes(w)
            )
        : null
      if (resto && !resto.length) {
        return {
          creado: false,
          error: `«${extra[clave!]}» no dice en qué agencia recoge. Pregúntale en qué agencia o sede de ${entrega.tipo.nombre} de su ciudad quiere recoger (nombre o dirección) antes de crear el pedido.`,
        }
      }
    }
    const tiene = (campo: string) => {
      const n = norm(campo)
      if (/nombre/.test(n) && String(args?.nombre ?? '').trim()) return true
      if (/telefono|celular/.test(n) && telefono) return true
      if (/^direccion/.test(n) && String(args?.direccion ?? '').trim()) return true
      if (/ciudad|departamento/.test(n) && String(args?.ciudad ?? '').trim()) return true
      return Object.keys(extra).some((k) => norm(k).includes(n) || n.includes(norm(k)))
    }
    const faltan = (entrega.tipo?.datos ?? []).filter((d) => !tiene(d))
    if (faltan.length) {
      return {
        creado: false,
        error: `Faltan estos datos: ${faltan.join(', ')}. Si el cliente YA los dijo en la conversación, vuelve a llamar a crear_pedido pasándolos en datosCliente con esa misma clave (p. ej. {"${faltan[0]}": "lo que dijo"}), sin preguntarle de nuevo. Solo si de verdad no los dio, pídeselos.`,
      }
    }

    const simbolo = business.currencySymbol || 'S/'
    const totalEstimado = PricingService.redondear(neto + entrega.envio)
    const adelanto = entrega.tipo ? SellerConfigService.adelanto(entrega.tipo, totalEstimado) : null
    const direccion =
      String(args?.direccion ?? '').trim() ||
      (entrega.tipo?.clase === 'agencia' || entrega.tipo?.clase === 'recojo'
        ? entrega.tipo.direccion || `${entrega.tipo.nombre}`
        : '')

    const datos = {
      customerName: String(args?.nombre ?? '').trim(),
      customerPhone: telefono,
      deliveryMethod: entrega.metodo,
      deliveryAddress: direccion || null,
      deliveryCity: args?.ciudad ? String(args.ciudad) : null,
      tableLabel: args?.mesa ? String(args.mesa) : null,
      note: [
        programado && 'PEDIDO PROGRAMADO (llegó con el local cerrado: preparar al abrir)',
        entrega.tipo && `Entrega: ${entrega.tipo.nombre} (zona ${entrega.zona?.nombre})`,
        entrega.tipo && entrega.detalle && `Envío: ${entrega.detalle}`,
        entrega.promesa && `Promesa: ${entrega.promesa}`,
        adelanto !== null && `Adelanto: ${simbolo} ${adelanto.toFixed(2)}`,
        ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
        args?.nota,
        'Pedido tomado por el vendedor IA de WhatsApp',
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 2000),
      couponCode: args?.cupon ? String(args.cupon) : null,
      items: lineasPedido,
    }
    const envioFijo = entrega.tipo ? entrega.envio : undefined

    try {
      const { order } = business.esRestaurante
        ? await OrderService.crearDesdeMenu(business, datos as any, {
            avisarCliente: false,
            envio: envioFijo,
          })
        : await OrderService.crearDesdeTienda(business, datos as any, { envio: envioFijo })

      await OrderService.marcarEnviadoPorWhatsapp(order)
      await PanelNotificationService.pedidoNuevo(business, order)
      ctx.pedidoCreado = order
      CARRITOS.delete(claveCarrito(business.id, ctx.phone))

      // Adelanto que el cliente pagó antes de que existiera el pedido: pasa a ser de este pedido.
      const pagados = business.esRestaurante
        ? []
        : await PaymentProofService.vincularSueltos(business, [ctx.phone, telefono], order)
      const montoPagado = pagados.reduce((t, p) => t + Number(p.amount ?? 0), 0)

      // Si hay que pagar antes, los QR marcados «al confirmar» van con la respuesta.
      const pagaAntes = entrega.tipo
        ? entrega.tipo.pago.tipo === 'adelantado'
        : business.paymentPolicy === 'on_confirm'
      if (pagaAntes && !pagados.length) {
        for (const m of PaymentMethodService.activos(business)) {
          for (const i of m.imagenes.filter((x) => x.cuando === 'al_confirmar')) {
            if (ctx.media.length < 4) {
              ctx.media.push({ url: StorageService.urlAbsoluta(i.url)!, caption: m.nombre })
            }
          }
        }
      }

      // Envío por agencia o motorizado: queda listo para que el dueño anote la guía.
      if (entrega.tipo && entrega.tipo.clase !== 'recojo') {
        const agencia =
          Object.entries(extra).find(([k]) => /agencia/i.test(k))?.[1] ??
          (entrega.tipo.clase === 'agencia' ? entrega.tipo.direccion || null : null)
        await ShipmentService.crear(
          business,
          {
            kind: 'pedido',
            orderId: order.id,
            carrier: entrega.tipo.nombre,
            agency: agencia,
            note: entrega.promesa ? `Promesa al cliente: ${entrega.promesa}` : null,
          },
          null
        ).catch((error) => logger.error({ err: error }, 'No se pudo crear el envío del pedido'))
      }

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
        ...(pagados.length
          ? {
              comprobanteYaRecibido: `${simbolo} ${montoPagado.toFixed(2)}`,
              nota: `El cliente YA mandó su comprobante (${simbolo} ${montoPagado.toFixed(2)}) y quedó asociado a este pedido, por validar por el negocio. Dale el código y el seguimiento, dile que su pago quedó registrado con el pedido y, si es un adelanto, cuánto pagará al recibir o recoger. NO le pidas el comprobante ni le vuelvas a dar los datos de pago.`,
            }
          : {}),
        ...(entrega.tipo
          ? {
              tipoEntrega: entrega.tipo.nombre,
              llega: entrega.promesa,
              envioDetalle: entrega.detalle,
              adelanto:
                adelanto !== null
                  ? SellerConfigService.adelanto(entrega.tipo, Number(order.total))
                  : null,
            }
          : {}),
        pago: entrega.tipo
          ? `${SellerConfigService.textoPago(entrega.tipo, simbolo)}. ${PaymentMethodService.textoParaCliente(business) ?? ''}`.trim()
          : business.paymentPolicy === 'on_confirm'
            ? `Por adelantado. ${PaymentMethodService.textoParaCliente(business) ?? 'Coordina el pago con el negocio.'}`
            : business.paymentPolicy === 'on_delivery'
              ? 'Contra entrega.'
              : PaymentMethodService.textoParaCliente(business) || 'Se coordina con el negocio.',
      }
    } catch (error) {
      if (error instanceof OrderError) {
        return {
          creado: false,
          error: error.message,
          nota: 'Corrige el dato y vuelve a intentar. No le pidas al cliente el comprobante otra vez ni le digas que no hay stock salvo que el error diga «Sin stock suficiente».',
        }
      }
      throw error
    }
  }

  /**
   * El cliente da o corrige un dato del pedido que acaba de hacer (la agencia
   * exacta, la referencia…). Solo pedidos propios, recientes y sin despachar;
   * el dueño recibe el aviso.
   */
  private static async corregirPedido(ctx: Contexto, args: any) {
    const { business } = ctx
    const digitos = ctx.phone.replace(/\D/g, '').slice(-9)
    const codigo = String(args?.codigoPedido ?? '')
      .trim()
      .toUpperCase()
    const order = await Order.query()
      .where('business_id', business.id)
      .andWhere('customer_phone', 'like', `%${digitos}`)
      .whereIn('status', ['pendiente', 'confirmado'])
      .andWhere('created_at', '>', DateTime.now().minus({ days: 2 }).toSQL()!)
      .if(codigo, (q) => q.andWhere('code', codigo))
      .orderBy('id', 'desc')
      .first()
    if (!order) {
      return {
        corregido: false,
        error:
          'No hay un pedido reciente sin despachar de este número. Si quiere cambiar algo, usa derivar_a_humano.',
      }
    }
    const datos: Record<string, string> = {}
    for (const [k, v] of Object.entries(args?.datos ?? {})) {
      const valor = String(v ?? '').trim()
      if (k.trim() && valor) datos[k.trim().slice(0, 60)] = valor.slice(0, 300)
    }
    if (!Object.keys(datos).length) return { corregido: false, error: 'No mandaste ningún dato.' }

    // En la nota del pedido cada dato va como «Clave: valor ·»: se reemplaza o se agrega.
    let nota = order.note ?? ''
    for (const [k, v] of Object.entries(datos)) {
      const escapada = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const patron = new RegExp(`(^|· )${escapada}: [^·]*`, 'i')
      nota = patron.test(nota) ? nota.replace(patron, `$1${k}: ${v} `) : `${nota} · ${k}: ${v}`
    }
    order.note = nota.replace(/\s+·/g, ' ·').trim().slice(0, 2000)
    const agencia = Object.entries(datos).find(([k]) => /agencia/i.test(k))?.[1]
    await order.save()
    if (agencia) {
      await Shipment.query()
        .where('business_id', business.id)
        .andWhere('order_id', order.id)
        .whereNull('shipped_at')
        .update({ agency: agencia })
    }
    try {
      await Notification.create({
        businessId: business.id,
        type: 'pedido',
        orderId: order.id,
        title: `Datos actualizados · ${order.code}`,
        body: Object.entries(datos)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ')
          .slice(0, 250),
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar la corrección del pedido')
    }
    return {
      corregido: true,
      pedido: order.code,
      nota: 'Listo, el pedido quedó actualizado y el negocio fue avisado. Confírmale el dato al cliente en una línea.',
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
    const envios = pedidos.length
      ? await Shipment.query()
          .where('business_id', business.id)
          .whereIn(
            'order_id',
            pedidos.map((o) => o.id)
          )
          .andWhereNot('status', 'cancelado')
      : []
    const estadoEnvio: Record<string, string> = {
      preparando: 'preparando el envío',
      en_transito: 'en camino',
      en_agencia: 'llegó a la agencia, listo para recoger',
      entregado: 'entregado',
      incidencia: 'con un inconveniente (deriva a una persona si pregunta)',
    }

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
        envio: envios
          .filter((e) => e.orderId === o.id)
          .map((e) => ({
            empresa: e.carrier,
            estado: estadoEnvio[e.status] ?? e.status,
            guia: e.trackingCode,
            claveRecojo: e.pickupKey,
            agencia: e.agency,
            rastreo: e.trackingUrl,
          }))[0],
      })),
      nota: pedidos.length
        ? 'Si el envío aún no tiene guía, dile que el negocio la enviará apenas despache.'
        : 'No hay pedidos con este número.',
    }
  }

  /**
   * Deja en el historial que esa foto era un comprobante ya registrado: el
   * historial solo guarda texto y, sin esto, en el siguiente mensaje el modelo
   * cree que nunca la recibió y la vuelve a pedir.
   */
  private static async anotarComprobante(
    ctx: Contexto,
    proof: { amount: number | null; method: string | null; operationCode: string | null },
    simbolo: string
  ) {
    if (!ctx.mensajeId) return
    try {
      const msg = await WhatsappMessage.find(ctx.mensajeId)
      if (!msg || msg.body.includes('comprobante de pago')) return
      const que = [
        proof.amount !== null && `${simbolo} ${Number(proof.amount).toFixed(2)}`,
        proof.method,
        proof.operationCode && `op. ${proof.operationCode}`,
      ]
        .filter(Boolean)
        .join(' ')
      const nota = `[El cliente envió su comprobante de pago${que ? ` (${que})` : ''}: ya quedó registrado]`
      msg.body = msg.body.includes('[El cliente envió una foto]')
        ? msg.body.replace('[El cliente envió una foto]', nota)
        : `${nota} ${msg.body}`
      await msg.save()
    } catch (error) {
      logger.error({ err: error }, 'No se pudo anotar el comprobante en la conversación')
    }
  }

  private static async registrarComprobante(ctx: Contexto, args: any) {
    const { business } = ctx
    const imagen = ctx.imagenes[Math.max(0, Number(args?.foto ?? 1) - 1)] ?? ctx.imagenes[0]
    if (!imagen) {
      // Sin foto en ESTE mensaje no significa que no la haya mandado antes.
      const previos = await PaymentProofService.recientes(business.id, [ctx.phone])
      if (previos.length) {
        const s = business.currencySymbol || 'S/'
        return {
          registrado: true,
          yaLoTeniamos: previos.map((p) => ({
            monto: p.amount !== null ? `${s} ${Number(p.amount).toFixed(2)}` : null,
            operacion: p.operationCode,
            pedido: p.order?.code ?? null,
            estado: p.status === 'validado' ? 'validado' : 'por validar',
          })),
          nota: 'Su comprobante YA está registrado. NO le pidas la foto otra vez. Si aún no hay pedido, sigue cerrándolo (crear_pedido): el comprobante se asocia solo.',
        }
      }
      return {
        registrado: false,
        error: 'En este mensaje no hay foto. Pídele que envíe la captura del comprobante.',
      }
    }
    const numero = (v: unknown) => {
      const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
      return Number.isFinite(n) && n > 0 ? n : null
    }
    const texto = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null)
    const r = await PaymentProofService.desdeChat(
      business,
      ctx.phone,
      imagen,
      {
        monto: numero(args?.monto),
        metodo: texto(args?.metodo),
        numeroOperacion: texto(args?.numeroOperacion),
        fecha: texto(args?.fecha),
        titular: texto(args?.titular),
        observacion: texto(args?.observacion),
      },
      texto(args?.codigoPedido)
    )
    const simbolo = business.currencySymbol || 'S/'
    await this.anotarComprobante(ctx, r.proof, simbolo)
    const deOtro =
      r.repetido &&
      Boolean(r.proof.phone) &&
      r.proof.phone!.replace(/\D/g, '').slice(-9) !== ctx.phone.replace(/\D/g, '').slice(-9)
    if (deOtro) {
      // Mismo número de operación desde otro cliente: posible comprobante reutilizado.
      await this.derivar(
        ctx,
        `Comprobante repetido: la operación ${r.proof.operationCode} ya la había enviado otro número`
      )
      return {
        registrado: false,
        nota: 'Ese número de operación ya fue registrado por otro cliente. No lo des por recibido ni acuses al cliente: dile con amabilidad que el negocio revisará ese comprobante y que una persona le escribe en breve.',
      }
    }
    if (r.repetido) {
      return {
        registrado: false,
        nota: `Ese comprobante (operación ${r.proof.operationCode}) ya lo habíamos recibido y está ${r.proof.status === 'validado' ? 'validado' : 'en revisión'}. Díselo con amabilidad.`,
      }
    }
    const monto = r.proof.amount
    const esperado = r.esperado
    return {
      registrado: true,
      pedido: r.order?.code ?? null,
      montoLeido: monto,
      saldoDelPedido: esperado,
      coincide: monto !== null && esperado !== null ? Math.abs(monto - esperado) < 0.02 : null,
      nota: [
        'Quedó guardado para que el negocio lo valide. Dile que lo recibiste y que en breve el negocio confirma el pago; NO digas que el pago está confirmado.',
        !r.order &&
          'Aún no hay pedido de este número: este pago es el ADELANTO del pedido que están armando. Si ya eligió productos y entrega y tienes sus datos, crea el pedido AHORA (cotizar_pedido y crear_pedido): el comprobante se asocia solo. Si falta algún dato, pide solo ese dato. NUNCA vuelvas a pedir la foto del comprobante. (Si dice que es de otro pedido anterior, pídele el código.)',
        monto !== null &&
          esperado !== null &&
          monto + 0.02 < esperado &&
          `El monto (${simbolo} ${monto.toFixed(2)}) es menor al saldo (${simbolo} ${esperado.toFixed(2)}): si es un adelanto está bien; recuérdale cuánto queda por pagar y cuándo.`,
        monto !== null &&
          esperado !== null &&
          monto > esperado + 0.02 &&
          'El monto es mayor al saldo: avísale que el negocio lo revisará.',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  /** Reserva de mesa: avisa al restaurante; la confirma una persona. */
  private static async solicitarReserva(ctx: Contexto, args: any) {
    const { business, phone } = ctx
    if (!SellerConfigService.config(business).restaurante.reservas.activo) {
      return {
        error: 'Este restaurante no toma reservas por aquí. Deriva a una persona si insiste.',
      }
    }
    const datos = [
      String(args?.nombre ?? '').trim(),
      args?.personas && `${Number(args.personas)} personas`,
      String(args?.fecha ?? '').trim(),
      String(args?.hora ?? '').trim(),
      String(args?.nota ?? '').trim(),
    ].filter(Boolean)
    if (datos.length < 4) {
      return { error: 'Faltan datos: nombre, número de personas, fecha y hora.' }
    }
    const titulo = 'Solicitud de reserva por WhatsApp'
    const cuerpo = `${datos.join(' · ')} · ${phone.replace(/\D/g, '')}`.slice(0, 250)
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
        tag: `reserva-${phone}`,
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar la reserva')
    }
    return {
      registrada: true,
      nota: 'Dile que su solicitud quedó registrada y que el restaurante le confirma por este chat. No la des por confirmada.',
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

const TIPO_ENTREGA_SCHEMA = {
  type: 'string',
  description:
    'Id del tipo de entrega elegido (aparece como [tipoEntregaId: …] en ENVÍOS Y ENTREGAS). Obligatorio si el negocio tiene zonas de envío.',
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
        'Detalle de un producto: variaciones con stock y precio (tienda) o grupos de opciones obligatorias/extras (restaurante). Trae también las preguntas frecuentes que el negocio dejó para ese producto (garantía, medidas, uso…). Úsalo antes de cotizar o pedir y cuando el cliente pregunte un detalle del producto.',
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
            description:
              'Opcional: fotos de esa variación (p. ej. el color que pidió) si tiene propias.',
          },
          cuantas: {
            type: 'number',
            description:
              'Cuántas fotos de la galería mandar (1 a 3). Usa 2-3 si pide "más fotos", "cómo se ve de espalda", etc.',
          },
          preguntaNumero: {
            type: 'number',
            description:
              'Opcional: el "numero" de una pregunta frecuente de ver_producto que tiene foto; manda esa foto en vez de la del producto.',
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
          tipoEntregaId: TIPO_ENTREGA_SCHEMA,
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
          tipoEntregaId: TIPO_ENTREGA_SCHEMA,
          direccion: {
            type: 'string',
            description: 'Dirección de entrega (o de la agencia donde recoge).',
          },
          datosCliente: {
            type: 'object',
            description:
              'Datos obligatorios del tipo de entrega con el nombre del dato como clave (p. ej. "DNI", "Referencia", "Agencia de recojo") y como valor EXACTAMENTE lo que dijo el cliente. Nunca rellenes un dato que el cliente no dio: pídeselo.',
            additionalProperties: { type: 'string' },
          },
          ciudad: { type: 'string' },
          mesa: { type: 'string', description: 'Obligatoria si la entrega es en mesa.' },
          pedidoAdicional: {
            type: 'boolean',
            description:
              'Solo si el cliente pide expresamente un SEGUNDO pedido igual a uno que ya hizo hoy.',
          },
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
        required: ['nombre', 'items'],
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
      name: 'solicitar_reserva',
      description:
        'Registra una solicitud de reserva de mesa y avisa al restaurante (la confirma una persona).',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          personas: { type: 'number' },
          fecha: { type: 'string', description: 'Ej. "sábado 22/11".' },
          hora: { type: 'string', description: 'Ej. "8:00 pm".' },
          nota: { type: 'string', description: 'Ocasión, preferencia de zona, etc.' },
        },
        required: ['nombre', 'personas', 'fecha', 'hora'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_qr_pago',
      description:
        'Envía el QR o la imagen de un método de pago (Yape, Plin…) junto con tu respuesta.',
      parameters: {
        type: 'object',
        properties: {
          metodoId: { type: 'string', description: 'El metodoId de la lista de métodos de pago.' },
        },
        required: ['metodoId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_sedes',
      description:
        'Busca las sedes / agencias (Shalom, Olva…) cargadas por el negocio en la ciudad, provincia o distrito del cliente, con su dirección. Son sugerencias del negocio, no todas las agencias existentes.',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', description: 'Nombre de la agencia, p. ej. "Shalom".' },
          lugar: {
            type: 'string',
            description:
              'Lo que dijo el cliente: distrito, provincia y/o departamento (p. ej. "Wanchaq Cusco").',
          },
        },
        required: ['empresa', 'lugar'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_comprobante',
      description:
        'Guarda el comprobante de pago (foto de Yape, Plin, transferencia o voucher) que el cliente envió en ESTE mensaje, con lo que leíste en la imagen. Úsalo aunque el pedido aún no exista (al crearlo se asocia solo). Queda por validar y se avisa al negocio.',
      parameters: {
        type: 'object',
        properties: {
          monto: { type: 'number', description: 'Monto pagado que se lee en el comprobante.' },
          metodo: { type: 'string', description: 'yape, plin, transferencia (banco), etc.' },
          numeroOperacion: { type: 'string', description: 'Número de operación / código.' },
          fecha: { type: 'string', description: 'Fecha y hora que muestra el comprobante.' },
          titular: { type: 'string', description: 'Nombre de quien pagó, si se ve.' },
          codigoPedido: {
            type: 'string',
            description:
              'Código del pedido si el cliente lo dijo; si no, se usa su último pedido con saldo.',
          },
          foto: {
            type: 'number',
            description: 'Si mandó varias fotos, cuál es el comprobante (1, 2…).',
          },
          observacion: {
            type: 'string',
            description:
              'Algo raro que notes (monto distinto, foto borrosa, nombre de otro destinatario…).',
          },
        },
        required: ['monto'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'corregir_pedido',
      description:
        'Agrega o corrige datos de entrega del pedido que el cliente ya hizo (agencia exacta de recojo, referencia, DNI, dirección…), mientras no se haya despachado. Úsalo cuando el cliente da o cambia un dato DESPUÉS de crear el pedido. No sirve para cambiar productos ni cantidades (para eso, derivar_a_humano).',
      parameters: {
        type: 'object',
        properties: {
          codigoPedido: {
            type: 'string',
            description: 'Código del pedido; si no, el último de este cliente.',
          },
          datos: {
            type: 'object',
            description:
              'Dato → valor tal como lo dijo el cliente, p. ej. {"Agencia de recojo": "<lo que dijo>"}.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['datos'],
        additionalProperties: false,
      },
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
      'Tienda: [{variacionId, cantidad}] con el variacionId de ver_producto (si no lo tienes: {productoId, detalle: "Negro", cantidad}). Restaurante: [{productoId, cantidad, opciones:[{opcionId, cantidad}], nota}].',
    items: {
      type: 'object',
      properties: {
        variacionId: { type: 'number' },
        productoId: { type: 'number' },
        detalle: {
          type: 'string',
          description:
            'Tienda: la variación en palabras (color, talla), solo si no tienes el variacionId.',
        },
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
