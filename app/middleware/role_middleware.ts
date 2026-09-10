import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Restringe una ruta a ciertos roles. Se apoya en el middleware de auth,
 * que debe correr antes.
 *
 *   router.get('/users', [...]).use([middleware.auth(), middleware.role(['superadmin'])])
 */
export default class RoleMiddleware {
  async handle(ctx: HttpContext, next: NextFn, allowedRoles: string[]) {
    const user = ctx.auth.user

    if (!user) {
      return ctx.response.unauthorized({
        status: 'error',
        message: 'No autenticado',
      })
    }

    await user.load('role')

    if (!user.role || !allowedRoles.includes(user.role.name)) {
      return ctx.response.forbidden({
        status: 'error',
        message: 'No tienes permiso para realizar esta acción',
      })
    }

    return next()
  }
}
