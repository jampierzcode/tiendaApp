import Notification from '#models/notification'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

/** Avisos del panel: lista reciente, cuántos hay sin leer y marcar como leídos. */
export default class NotificationsController {
  public async index({ business, request }: HttpContext) {
    const soloSinLeer = request.input('unread') === '1'
    const consulta = Notification.query().where('business_id', business.id)
    if (soloSinLeer) consulta.whereNull('read_at')

    const items = await consulta.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(30)
    const [fila] = await Notification.query()
      .where('business_id', business.id)
      .whereNull('read_at')
      .count('* as total')

    return { status: 'success', data: { items, unread: Number(fila.$extras.total) } }
  }

  public async read({ business, params, response }: HttpContext) {
    const n = await Notification.query()
      .where('business_id', business.id)
      .where('id', params.id)
      .first()
    if (!n) return response.notFound({ status: 'error', message: 'Notificación no encontrada' })
    if (!n.readAt) {
      n.readAt = DateTime.now()
      await n.save()
    }
    return { status: 'success', data: n }
  }

  public async readAll({ business }: HttpContext) {
    await Notification.query()
      .where('business_id', business.id)
      .whereNull('read_at')
      .update({ read_at: DateTime.now().toSQL() })
    return { status: 'success' }
  }

  public async destroy({ business, params, response }: HttpContext) {
    const borradas = await Notification.query()
      .where('business_id', business.id)
      .where('id', params.id)
      .delete()
    if (!borradas) return response.notFound({ status: 'error', message: 'Notificación no encontrada' })
    return { status: 'success' }
  }
}
