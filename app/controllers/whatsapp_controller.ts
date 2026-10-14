import Order from '#models/order'
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
    if (!this.autorizado(ctx)) return
    const { request, response } = ctx

    const { businessUuid, phone, text } = request.only(['businessUuid', 'phone', 'text'])
    const business = await Business.findBy('uuid', businessUuid)
    if (!business) return response.notFound({ status: 'error', message: 'Negocio no encontrado' })

    const mensaje = String(text ?? '')
      .trim()
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
