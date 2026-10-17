import PushService from '#services/push_service'
import PushSubscription from '#models/push_subscription'
import type { HttpContext } from '@adonisjs/core/http'

/** Alta y baja de los avisos push del navegador del usuario con sesión. */
export default class PushController {
  public async key({ response }: HttpContext) {
    const key = PushService.clavePublica()
    if (!key) return response.notFound({ status: 'error', message: 'Los avisos push no están activos' })
    return { status: 'success', data: { key } }
  }

  public async subscribe({ auth, request, response }: HttpContext) {
    const { endpoint, keys } = request.only(['endpoint', 'keys'])
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return response.unprocessableEntity({ status: 'error', message: 'Suscripción incompleta' })
    }
    // Un mismo navegador puede pasar de una cuenta a otra: el endpoint se reasigna.
    await PushSubscription.updateOrCreate(
      { endpoint: String(endpoint) },
      { userId: auth.user!.id, p256dh: String(keys.p256dh), auth: String(keys.auth) }
    )
    return { status: 'success' }
  }

  public async unsubscribe({ auth, request }: HttpContext) {
    const endpoint = String(request.input('endpoint') ?? '')
    if (endpoint) {
      await PushSubscription.query().where('endpoint', endpoint).where('user_id', auth.user!.id).delete()
    }
    return { status: 'success' }
  }
}
