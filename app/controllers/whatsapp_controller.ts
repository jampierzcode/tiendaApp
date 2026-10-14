import Order from '#models/order'
import WhatsappMessage from '#models/whatsapp_message'
import WhatsappOutbox from '#models/whatsapp_outbox'
import WhatsappSession from '#models/whatsapp_session'
import NotificationService, { EVENTOS } from '#services/notification_service'
import Business from '#models/business'
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
      (await WhatsappSession.create({ businessId, desired: 'disconnected', status: 'disconnected' }))
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
      },
    }
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
      .select(db.raw("sum(case when direction = 'in' and read_at is null then 1 else 0 end) as unread"))
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

    return {
      status: 'success',
      data: filas.map((f) => {
        const u = porId.get(f.lastId)
        return {
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
    const texto = String(request.input('text') ?? '').trim().slice(0, 1000)
    if (!texto) return response.badRequest({ status: 'error', message: 'Escribe un mensaje' })

    const ultimo = await WhatsappMessage.query()
      .where('business_id', business.id)
      .andWhere('contact', params.contact)
      .orderBy('id', 'desc')
      .first()
    // Sin historial aún (p. ej. desde un pedido): se usa el teléfono del pedido.
    const destino = ultimo?.phone ?? String(request.input('phone') ?? '').replace(/\D/g, '')
    if (!destino) return response.notFound({ status: 'error', message: 'Conversación no encontrada' })

    const sesion = await WhatsappSession.query().where('business_id', business.id).first()
    if (!sesion || sesion.desired !== 'connected') {
      return response.badRequest({ status: 'error', message: 'Conecta el WhatsApp del negocio primero' })
    }

    await NotificationService.encolar(business, {
      phone: destino,
      event: 'chat',
      body: texto,
      automatic: false,
    })
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
    const negocios = await Business.query().whereIn(
      'id',
      sesiones.map((s) => s.businessId)
    )
    const uuidPorId = new Map(negocios.map((b) => [b.id, b.uuid]))

    return {
      status: 'success',
      data: sesiones.map((s) => ({
        businessUuid: uuidPorId.get(s.businessId),
        desired: s.desired,
        status: s.status,
      })),
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
      qr: status === 'qr' ? qr ?? null : null,
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
   * Mensaje entrante de un cliente. Devuelve la respuesta a enviar, o null si
   * el bot debe callar (no inventa conversación con quien no la inició).
   */
  public async inbound(ctx: HttpContext) {
    const salida: any = await this.inboundInterno(ctx)
    if (salida?.reply) {
      const { businessUuid, phone } = ctx.request.only(['businessUuid', 'phone'])
      const negocio = await Business.findBy('uuid', businessUuid)
      if (negocio) {
        await NotificationService.registrar(negocio.id, String(phone ?? ''), 'out', salida.reply, true)
      }
    }
    return salida
  }

  private async inboundInterno(ctx: HttpContext) {
    if (!this.autorizado(ctx)) return
    const { request, response } = ctx

    const { businessUuid, phone, text } = request.only(['businessUuid', 'phone', 'text'])
    const business = await Business.findBy('uuid', businessUuid)
    if (!business) return response.notFound({ status: 'error', message: 'Negocio no encontrado' })

    const crudo = String(text ?? '').trim()
    if (crudo) {
      await NotificationService.registrar(business.id, String(phone ?? ''), 'in', crudo.slice(0, 2000), false)
    }

    const mensaje = crudo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    const base = (env.get('STORE_PUBLIC_URL') ?? '').replace(/\/$/, '')
    const enlace = `${base}/t/${business.slug}`

    if (/\b(menu|carta|pedir|pedido nuevo|hola|buenas)\b/.test(mensaje)) {
      return {
        status: 'success',
        reply: `¡Hola! 👋 Bienvenido a ${business.name}.\nMira nuestra carta y haz tu pedido aquí:\n${enlace}`,
      }
    }

    if (/\b(estado|pedido|donde|cuanto falta|seguimiento)\b/.test(mensaje)) {
      const digitos = String(phone ?? '').replace(/\D/g, '')
      const ultimo = await Order.query()
        .where('business_id', business.id)
        .andWhere('customer_phone', 'like', `%${digitos.slice(-9)}`)
        .orderBy('id', 'desc')
        .first()

      if (!ultimo) {
        return { status: 'success', reply: `No encontramos pedidos con este número. Haz uno en ${enlace}` }
      }

      return {
        status: 'success',
        reply: `Tu pedido ${ultimo.code} está *${ultimo.status}*.\nSíguelo aquí: ${NotificationService.enlaceSeguimiento(business, ultimo)}`,
      }
    }

    return { status: 'success', reply: null }
  }
}
