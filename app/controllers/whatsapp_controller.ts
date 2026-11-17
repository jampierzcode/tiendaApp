import Order from '#models/order'
import WhatsappMessage from '#models/whatsapp_message'
import WhatsappOutbox from '#models/whatsapp_outbox'
import WhatsappSession from '#models/whatsapp_session'
import NotificationService, { EVENTOS } from '#services/notification_service'
import SellerConfigService, { DATOS_SUGERIDOS } from '#services/seller_config_service'
import SalesAgentService from '#services/sales_agent_service'
import WhatsappAgentPause from '#models/whatsapp_agent_pause'
import logger from '@adonisjs/core/services/logger'
import Business from '#models/business'
import Customer from '#models/customer'
import PushService from '#services/push_service'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Panel del negocio: conectar su número, ver el QR y editar las plantillas.
 */
export class WhatsappPanelController {
  private async sesion(businessId: number) {
    return (
      (await WhatsappSession.query().where('business_id', businessId).first()) ??
      (await WhatsappSession.create({
        businessId,
        desired: 'disconnected',
        status: 'disconnected',
      }))
    )
  }

  public async show({ business }: HttpContext) {
    const sesion = await this.sesion(business.id)

    const pendientes = await db
      .from('whatsapp_outbox')
      .where('business_id', business.id)
      .whereIn('status', ['pendiente', 'enviando'])
      .count('* as total')
      .first()

    return {
      status: 'success',
      data: {
        desired: sesion.desired,
        status: sesion.status,
        qr: sesion.status === 'qr' ? sesion.qr : null,
        connectedPhone: sesion.connectedPhone,
        pendingMessages: Number(pendientes?.total ?? 0),
        templates: Object.fromEntries(
          EVENTOS.map((e) => [e, NotificationService.plantillaDe(business, e)])
        ),
        defaults: NotificationService.plantillasPorDefecto(),
        agent: {
          enabled: business.aiAgentEnabled,
          instructions: business.aiAgentInstructions ?? '',
          // Sin OPENAI_API_KEY en el servidor el asistente no puede funcionar.
          available: SalesAgentService.disponible(),
          pauseMinutes: SalesAgentService.pausaHumanoMin(),
        },
      },
    }
  }

  /** Enciende/apaga el asistente con IA y guarda lo que debe saber del negocio. */
  public async saveAgent({ business, request }: HttpContext) {
    const enabled = request.input('enabled')
    if (typeof enabled === 'boolean') business.aiAgentEnabled = enabled
    const instrucciones = request.input('instructions')
    if (typeof instrucciones === 'string') {
      business.aiAgentInstructions = instrucciones.trim().slice(0, 4000) || null
    }
    await business.save()
    return { status: 'success', message: 'Asistente actualizado' }
  }

  /** Configuración del vendedor IA: personalidad, saludo, FAQ y envíos. */
  public async sellerConfig({ business }: HttpContext) {
    return {
      status: 'success',
      data: {
        enabled: business.aiAgentEnabled,
        available: SalesAgentService.disponible(),
        instructions: business.aiAgentInstructions ?? '',
        config: SellerConfigService.config(business),
        zonas: SellerConfigService.zonas(business),
        datosSugeridos: DATOS_SUGERIDOS,
        currencySymbol: business.currencySymbol || 'S/',
        businessName: business.name,
        isRestaurant: business.esRestaurante,
      },
    }
  }

  public async saveSellerConfig({ business, request }: HttpContext) {
    const config = request.input('config')
    if (config && typeof config === 'object') {
      business.aiAgentConfig = JSON.stringify(SellerConfigService.limpiarConfig(config))
    }
    const zonas = request.input('zonas')
    if (Array.isArray(zonas)) {
      business.shippingZones = JSON.stringify(SellerConfigService.limpiarZonas(zonas))
    }
    await business.save()
    return {
      status: 'success',
      message: 'Vendedor actualizado',
      data: {
        config: SellerConfigService.config(business),
        zonas: SellerConfigService.zonas(business),
      },
    }
  }

  /** Devuelve la conversación al asistente antes de que venza la pausa. */
  public async resumeAgent({ business, params }: HttpContext) {
    await SalesAgentService.reanudar(business.id, params.contact)
    return { status: 'success', message: 'El asistente vuelve a responder a este cliente' }
  }

  public async connect({ business }: HttpContext) {
    const sesion = await this.sesion(business.id)
    sesion.merge({ desired: 'connected', status: 'connecting', qr: null })
    await sesion.save()
    return { status: 'success', message: 'Solicitando conexión…' }
  }

  public async disconnect({ business }: HttpContext) {
    const sesion = await this.sesion(business.id)
    // Se marca ya como desconectado: si el bot no tenía sesión levantada no
    // habrá nadie que lo reporte, y el panel se quedaría en «Conectando…».
    // Si sí la tenía, el bot lo confirma al cerrarla.
    sesion.merge({ desired: 'disconnected', status: 'disconnected', qr: null })
    await sesion.save()
    return { status: 'success', message: 'Desconectando…' }
  }

  /** Conversaciones: una por cliente, con el último mensaje y lo no leído. */
  public async conversations({ business }: HttpContext) {
    const filas = await db
      .from('whatsapp_messages')
      .where('business_id', business.id)
      .groupBy('contact')
      .select('contact')
      .max('id as lastId')
      .count('* as total')
      .select(
        db.raw("sum(case when direction = 'in' and read_at is null then 1 else 0 end) as unread")
      )
      .orderBy('lastId', 'desc')
      .limit(100)

    const ultimos = await WhatsappMessage.query().whereIn(
      'id',
      filas.map((f) => f.lastId)
    )
    const porId = new Map(ultimos.map((m) => [m.id, m]))

    // Nombre del cliente: el del pedido más reciente con ese teléfono.
    const pedidos = await Order.query()
      .where('business_id', business.id)
      .orderBy('id', 'desc')
      .limit(500)
    const nombre = new Map<string, string>()
    for (const o of pedidos) {
      const k = (o.customerPhone ?? '').replace(/\D/g, '').slice(-9)
      if (k && !nombre.has(k)) nombre.set(k, o.customerName)
    }

    const pausas = await WhatsappAgentPause.query()
      .where('business_id', business.id)
      .andWhere('paused_until', '>', DateTime.now().toSQL()!)
    const pausado = new Map(pausas.map((p) => [p.contact, p]))

    return {
      status: 'success',
      data: filas.map((f) => {
        const u = porId.get(f.lastId)
        return {
          agentPaused: pausado.has(f.contact),
          agentPauseReason: pausado.get(f.contact)?.reason ?? null,
          agentPausedUntil: pausado.get(f.contact)?.pausedUntil ?? null,
          contact: f.contact,
          phone: u?.phone ?? f.contact,
          name: nombre.get(f.contact) ?? null,
          lastMessage: u?.body ?? '',
          lastDirection: u?.direction ?? 'in',
          lastAt: u?.createdAt,
          unread: Number(f.unread ?? 0),
        }
      }),
    }
  }

  /** Mensajes de una conversación; al abrirla quedan como leídos. */
  public async messages({ business, params }: HttpContext) {
    const mensajes = await WhatsappMessage.query()
      .where('business_id', business.id)
      .andWhere('contact', params.contact)
      .orderBy('id', 'desc')
      .limit(200)

    await WhatsappMessage.query()
      .where('business_id', business.id)
      .andWhere('contact', params.contact)
      .andWhere('direction', 'in')
      .whereNull('read_at')
      .update({ read_at: DateTime.now().toSQL() })

    return { status: 'success', data: mensajes.reverse() }
  }

  public async send({ business, params, request, response }: HttpContext) {
    const texto = String(request.input('text') ?? '')
      .trim()
      .slice(0, 1000)
    if (!texto) return response.badRequest({ status: 'error', message: 'Escribe un mensaje' })

    const ultimo = await WhatsappMessage.query()
      .where('business_id', business.id)
      .andWhere('contact', params.contact)
      .orderBy('id', 'desc')
      .first()
    // Sin historial aún (p. ej. desde un pedido): se usa el teléfono del pedido.
    const destino = ultimo?.phone ?? String(request.input('phone') ?? '').replace(/\D/g, '')
    if (!destino)
      return response.notFound({ status: 'error', message: 'Conversación no encontrada' })

    const sesion = await WhatsappSession.query().where('business_id', business.id).first()
    if (!sesion || sesion.desired !== 'connected') {
      return response.badRequest({
        status: 'error',
        message: 'Conecta el WhatsApp del negocio primero',
      })
    }

    await NotificationService.encolar(business, {
      phone: destino,
      event: 'chat',
      body: texto,
      automatic: false,
    })
    // El dueño tomó la conversación: el asistente no se le cruza.
    await SalesAgentService.pausar(
      business.id,
      destino,
      SalesAgentService.pausaHumanoMin(),
      'El negocio respondió desde el panel'
    )
    return { status: 'success', message: 'Enviando…' }
  }

  /** Total de mensajes sin leer: alimenta el globito y las notificaciones. */
  public async unread({ business }: HttpContext) {
    const fila = await db
      .from('whatsapp_messages')
      .where('business_id', business.id)
      .andWhere('direction', 'in')
      .whereNull('read_at')
      .count('* as total')
      .first()
    return { status: 'success', data: { unread: Number(fila?.total ?? 0) } }
  }

  public async saveTemplates({ business, request }: HttpContext) {
    const entrada = request.input('templates') ?? {}
    const limpias: Record<string, string> = {}

    for (const evento of EVENTOS) {
      const texto = String(entrada[evento] ?? '').trim()
      if (texto && texto !== NotificationService.plantillasPorDefecto()[evento]) {
        limpias[evento] = texto.slice(0, 1000)
      }
    }

    business.notificationTemplates = Object.keys(limpias).length ? JSON.stringify(limpias) : null
    await business.save()

    return { status: 'success', message: 'Plantillas guardadas' }
  }
}

/**
 * API que consume el servicio del bot (no el navegador). Se autentica con la
 * clave compartida BOT_API_KEY; el bot no es un usuario del sistema.
 */
export default class WhatsappBotController {
  private autorizado({ request, response }: HttpContext) {
    const clave = env.get('BOT_API_KEY')
    if (!clave || request.header('x-bot-key') !== clave) {
      response.unauthorized({ status: 'error', message: 'Clave del bot inválida' })
      return false
    }
    return true
  }

  /** Sesiones que el bot debe levantar o apagar. */
  public async sessions(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return

    const sesiones = await WhatsappSession.all()
    const negocios = await Business.query()
      .whereIn(
        'id',
        sesiones.map((s) => s.businessId)
      )
      .preload('currentPlan')
    const porId = new Map(negocios.map((b) => [b.id, b]))

    return {
      status: 'success',
      data: sesiones.map((s) => {
        const negocio = porId.get(s.businessId)
        // Un negocio desactivado o con el plan vencido no puede vender: su
        // navegador (~300 MB de RAM) se apaga sin cerrar la sesión de WhatsApp,
        // y vuelve solo, sin escanear, cuando renueva.
        const enPausa =
          s.desired === 'connected' &&
          (!negocio ||
            negocio.status !== 'activo' ||
            negocio.subscriptionExpired ||
            !negocio.tieneFuncion('whatsapp'))
        return {
          businessUuid: negocio?.uuid,
          desired: enPausa ? 'paused' : s.desired,
          status: s.status,
        }
      }),
    }
  }

  /** El bot reporta su estado y, si hace falta, el QR a escanear. */
  public async reportSession(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return
    const { params, request, response } = ctx

    const business = await Business.findBy('uuid', params.businessUuid)
    if (!business) return response.notFound({ status: 'error', message: 'Negocio no encontrado' })

    const sesion =
      (await WhatsappSession.query().where('business_id', business.id).first()) ??
      (await WhatsappSession.create({
        businessId: business.id,
        desired: 'disconnected',
        status: 'disconnected',
      }))

    const { status, qr, connectedPhone } = request.only(['status', 'qr', 'connectedPhone'])
    sesion.merge({
      status: status ?? sesion.status,
      qr: status === 'qr' ? (qr ?? null) : null,
      connectedPhone: connectedPhone ?? (status === 'connected' ? sesion.connectedPhone : null),
    })
    await sesion.save()

    return { status: 'success' }
  }

  /** Reclama un lote de mensajes pendientes (los marca como «enviando»). */
  public async claim(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return

    const limite = Math.min(20, Number(ctx.request.input('limit', 10)))
    const mensajes = await WhatsappOutbox.query()
      .where('status', 'pendiente')
      .orderBy('id', 'asc')
      .limit(limite)

    const negocios = await Business.query().whereIn('id', [
      ...new Set(mensajes.map((m) => m.businessId)),
    ])
    const uuidPorId = new Map(negocios.map((b) => [b.id, b.uuid]))

    for (const m of mensajes) {
      m.status = 'enviando'
      m.attempts += 1
      await m.save()
    }

    return {
      status: 'success',
      data: mensajes.map((m) => ({
        id: m.id,
        businessUuid: uuidPorId.get(m.businessId),
        phone: m.phone,
        body: m.body,
      })),
    }
  }

  public async result(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return
    const { params, request, response } = ctx

    const mensaje = await WhatsappOutbox.find(params.id)
    if (!mensaje) return response.notFound({ status: 'error', message: 'Mensaje no encontrado' })

    const { ok, error, requeue } = request.only(['ok', 'error', 'requeue'])

    if (requeue) {
      // La sesión aún no estaba lista: no es culpa del mensaje, así que el
      // intento no cuenta y vuelve a la cola para cuando el bot conecte.
      mensaje.merge({
        status: 'pendiente',
        attempts: Math.max(0, mensaje.attempts - 1),
        error: 'esperando sesión de WhatsApp',
      })
    } else if (ok) {
      mensaje.merge({ status: 'enviado', sentAt: DateTime.now(), error: null })
    } else {
      // Hasta 3 intentos; luego queda en error para revisarlo.
      mensaje.merge({
        status: mensaje.attempts >= 3 ? 'error' : 'pendiente',
        error: String(error ?? 'desconocido').slice(0, 255),
      })
    }
    await mensaje.save()

    return { status: 'success' }
  }

  /**
   * Mensaje entrante de un cliente. Devuelve la respuesta a enviar (texto y,
   * si hace falta, fotos), o null si el bot debe callar.
   *
   * Con el asistente de IA encendido conversa y vende; si está apagado, sin
   * clave o falla, quedan las reglas de siempre («menú», «mi pedido»).
   */
  private async avisarMensaje(business: Business, telefono: string, texto: string) {
    try {
      const digitos = telefono.replace(/\D/g, '')
      const cliente = await Customer.query()
        .where('business_id', business.id)
        .andWhere('phone', 'like', `%${digitos.slice(-9)}`)
        .first()
      const quien = cliente?.name || (digitos.length <= 13 ? `+${digitos}` : 'un cliente')
      const atiendeIa =
        SalesAgentService.disponible() &&
        business.aiAgentEnabled &&
        !(await SalesAgentService.enPausa(business.id, telefono))
      await PushService.enviar(business.userId, {
        title: `💬 ${quien}`,
        body: `${texto.slice(0, 110)}${atiendeIa ? ' · Lo atiende tu vendedor IA' : ''}`,
        url: `/b/${business.uuid}/chat`,
        // Misma etiqueta que el aviso de la pestaña: si llegan los dos, se ve uno solo.
        tag: 'chat',
      })
    } catch (error) {
      logger.error({ err: error }, 'No se pudo avisar el mensaje de WhatsApp')
    }
  }

  public async inbound(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return
    const { request, response } = ctx

    const { businessUuid, phone, text, kind } = request.only([
      'businessUuid',
      'phone',
      'text',
      'kind',
    ])
    // Fotos del cliente (base64) para que el asistente las vea. Máx. 3 y ~6 MB c/u.
    const crudas = request.input('images')
    const imagenes = (Array.isArray(crudas) ? crudas : [])
      .filter(
        (i: any) =>
          typeof i?.data === 'string' &&
          /^image\/(jpeg|png|webp|gif)$/.test(String(i?.mime)) &&
          i.data.length < 8_000_000
      )
      .slice(0, 3)
      .map((i: any) => ({ mime: String(i.mime), data: String(i.data) }))
    const business = await Business.query()
      .where('uuid', businessUuid)
      .preload('currentPlan')
      .first()
    if (!business) return response.notFound({ status: 'error', message: 'Negocio no encontrado' })

    const telefono = String(phone ?? '')
    let crudo = String(text ?? '')
      .trim()
      .slice(0, 2000)
    // Fotos, audios o stickers llegan sin texto: se describen para el asistente.
    if (kind && kind !== 'chat' && kind !== 'text') {
      const tipo: Record<string, string> = {
        // Lo que queda en la conversación es neutro: en turnos siguientes la foto ya no va adjunta.
        image: 'una foto',
        ptt: 'un audio de voz (no puedes escucharlo: pídele con amabilidad que lo escriba)',
        audio: 'un audio (no puedes escucharlo: pídele con amabilidad que lo escriba)',
        video: 'un video',
        document: 'un documento',
        sticker: 'un sticker',
        location: 'su ubicación',
      }
      crudo = `[El cliente envió ${tipo[kind] ?? 'un archivo'}]${crudo ? ` ${crudo}` : ''}`
    }
    if (!crudo) return { status: 'success', reply: null, media: [] }

    const entrante = await NotificationService.registrar(business.id, telefono, 'in', crudo, false)

    // Aviso del navegador al dueño (como Messenger): llega aunque el panel esté en otra pestaña
    // o cerrado. No se espera: el cliente recibe su respuesta igual si el envío del aviso tarda.
    void this.avisarMensaje(business, telefono, crudo)

    // Solo para este turno: decirle al modelo si la foto viene adjunta o no se pudo abrir.
    const paraModelo =
      kind === 'image'
        ? crudo.replace(
            '[El cliente envió una foto]',
            imagenes.length
              ? '[El cliente envió una foto: la tienes adjunta, mírala]'
              : '[El cliente envió una foto que no se pudo abrir: pídele que te cuente qué es]'
          )
        : crudo

    let salida: { reply: string | null; media: { url: string; caption?: string }[] } | null = null
    try {
      // El vendedor IA es del plan más alto; sin él contestan las reglas fijas.
      if (business.tieneFuncion('vendedor_ia'))
        salida = await SalesAgentService.responder(
          business,
          telefono,
          paraModelo,
          entrante.id,
          imagenes
        )
    } catch (error) {
      logger.error(
        { err: error, business: business.id },
        'El asistente de WhatsApp falló; uso las reglas fijas'
      )
    }

    // Conversación tomada por el dueño: ni IA ni reglas.
    if (!salida && (await SalesAgentService.enPausa(business.id, telefono))) {
      return { status: 'success', reply: null, media: [] }
    }

    if (!salida) {
      const regla = await this.respuestaPorReglas(business, telefono, crudo)
      salida = { reply: regla, media: [] }
    }

    for (const m of salida.media) {
      await NotificationService.registrar(
        business.id,
        telefono,
        'out',
        `📷 ${m.caption ?? 'Foto'}`,
        true
      )
    }
    if (salida.reply) {
      await NotificationService.registrar(business.id, telefono, 'out', salida.reply, true)
    }

    return { status: 'success', reply: salida.reply, media: salida.media }
  }

  /**
   * El dueño escribió desde el propio celular (no desde el panel): se anota
   * en la conversación y el asistente se aparta con ese cliente.
   */
  public async ownerMessage(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return
    const { request, response } = ctx
    const { businessUuid, phone, text, pause } = request.only([
      'businessUuid',
      'phone',
      'text',
      'pause',
    ])
    const business = await Business.findBy('uuid', businessUuid)
    if (!business) return response.notFound({ status: 'error', message: 'Negocio no encontrado' })

    const telefono = String(phone ?? '')
    const cuerpo = String(text ?? '')
      .trim()
      .slice(0, 2000)
    if (!telefono) return { status: 'success' }
    if (cuerpo) await NotificationService.registrar(business.id, telefono, 'out', cuerpo, false)
    // Bienvenida/ausencia automática de WhatsApp Business: se anota, pero no
    // es el dueño tomando la conversación.
    if (pause === false) return { status: 'success' }
    await SalesAgentService.pausar(
      business.id,
      telefono,
      SalesAgentService.pausaHumanoMin(),
      'El negocio respondió desde el celular'
    )
    return { status: 'success' }
  }

  /** Respuestas fijas de siempre: «menú» y «mi pedido». */
  private async respuestaPorReglas(business: Business, phone: string, crudo: string) {
    const mensaje = crudo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const base = (env.get('STORE_PUBLIC_URL') ?? '').replace(/\/$/, '')
    const enlace = `${base}/t/${business.slug}`

    if (/\b(menu|carta|pedir|pedido nuevo|hola|buenas)\b/.test(mensaje)) {
      return `¡Hola! 👋 Bienvenido a ${business.name}.\nMira nuestra carta y haz tu pedido aquí:\n${enlace}`
    }

    if (/\b(estado|pedido|donde|cuanto falta|seguimiento)\b/.test(mensaje)) {
      const digitos = String(phone ?? '').replace(/\D/g, '')
      const ultimo = await Order.query()
        .where('business_id', business.id)
        .andWhere('customer_phone', 'like', `%${digitos.slice(-9)}`)
        .orderBy('id', 'desc')
        .first()

      if (!ultimo) {
        return `No encontramos pedidos con este número. Haz uno en ${enlace}`
      }

      return `Tu pedido ${ultimo.code} está *${ultimo.status}*.\nSíguelo aquí: ${NotificationService.enlaceSeguimiento(business, ultimo)}`
    }

    return null
  }
}
