import Business from '#models/business'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    /**
     * Negocio sobre el que opera la petición. Lo resuelve TenantMiddleware
     * a partir del `:businessUuid` de la ruta y siempre está validado
     * contra el usuario autenticado.
     */
    business: Business
  }
}

/**
 * Resuelve el negocio desde la URL y comprueba que el usuario autenticado
 * puede operarlo.
 *
 * Antes cada controlador hacía `Business.findByOrFail('user_id', user.id)`,
 * que devolvía siempre el primer negocio del usuario e ignoraba cuál estaba
 * abierto en el panel. Con esto el negocio sale de la ruta, se valida una
 * sola vez, y los controladores solo leen `ctx.business`.
 */
export default class TenantMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user

    if (!user) {
      return ctx.response.unauthorized({ status: 'error', message: 'No autenticado' })
    }

    const businessUuid = ctx.params.businessUuid

    if (!businessUuid) {
      return ctx.response.badRequest({
        status: 'error',
        message: 'Falta el identificador del negocio en la ruta',
      })
    }

    const business = await Business.findBy('uuid', businessUuid)

    if (!business) {
      return ctx.response.notFound({ status: 'error', message: 'Negocio no encontrado' })
    }

    await user.load('role')
    const isSuperAdmin = user.role?.name === 'superadmin'

    if (!isSuperAdmin && business.userId !== user.id) {
      return ctx.response.forbidden({
        status: 'error',
        message: 'No tienes acceso a este negocio',
      })
    }

    if (!isSuperAdmin && business.status !== 'activo') {
      return ctx.response.forbidden({
        status: 'error',
        message: 'Este negocio está inactivo',
      })
    }

    // Prueba vencida: se puede mirar el panel, pero no operar hasta activar.
    if (
      !isSuperAdmin &&
      business.trialExpired &&
      !['GET', 'HEAD', 'OPTIONS'].includes(ctx.request.method())
    ) {
      return ctx.response.status(402).send({
        status: 'error',
        code: 'trial_expired',
        message: 'Tu prueba gratis terminó. Activa tu plan para seguir operando.',
      })
    }

    ctx.business = business

    return next()
  }
}
