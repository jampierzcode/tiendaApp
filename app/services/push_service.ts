import PushSubscription from '#models/push_subscription'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import webpush from 'web-push'

export interface AvisoPush {
  title: string
  body: string
  /** Ruta del front que se abre al tocar el aviso. */
  url: string
  /** Avisos con la misma etiqueta se reemplazan entre sí. */
  tag?: string
}

/**
 * Avisos push del navegador. Nunca debe romper la operación que los dispara
 * (un pedido, un mensaje): si no hay claves o el envío falla, se registra y se sigue.
 */
export default class PushService {
  private static listo: boolean | null = null

  private static configurar() {
    if (this.listo !== null) return this.listo
    const publica = env.get('VAPID_PUBLIC_KEY')
    const privada = env.get('VAPID_PRIVATE_KEY')
    if (!publica || !privada) {
      this.listo = false
      return false
    }
    // El «subject» es un dato de contacto para el servicio de push (Google, Mozilla, Apple); no lo ve ningún usuario.
    // Sin VAPID_SUBJECT se usa la URL pública de la tienda, así no hace falta poner un correo personal.
    // Debe ser mailto: o https:; en local (http) se usa un https de relleno.
    const url = env.get('STORE_PUBLIC_URL')
    const subject = env.get('VAPID_SUBJECT') ?? (url?.startsWith('https://') ? url : 'https://localhost')
    try {
      webpush.setVapidDetails(subject, publica, privada)
      this.listo = true
    } catch (error) {
      logger.error({ err: error }, 'Claves VAPID inválidas: los avisos push quedan apagados')
      this.listo = false
    }
    return this.listo
  }

  static clavePublica() {
    return this.configurar() ? env.get('VAPID_PUBLIC_KEY')! : null
  }

  static async enviar(userId: number | null | undefined, aviso: AvisoPush) {
    // En las pruebas no se sale a internet.
    if (!userId || env.get('NODE_ENV') === 'test' || !this.configurar()) return
    try {
      const subs = await PushSubscription.query().where('user_id', userId)
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify(aviso),
              { TTL: 60 * 60 * 24 }
            )
          } catch (error: any) {
            // 404/410: el navegador ya no existe o revocó el permiso.
            if (error?.statusCode === 404 || error?.statusCode === 410) await s.delete()
            else logger.warn({ err: error?.message }, 'No se pudo enviar el aviso push')
          }
        })
      )
    } catch (error) {
      logger.error({ err: error }, 'Fallo al enviar avisos push')
    }
  }
}
