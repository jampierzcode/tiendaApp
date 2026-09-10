import Role from '#models/role'
import User from '#models/user'
import { loginValidator, registerValidator, updatePasswordValidator } from '#validators/auth'
import hash from '@adonisjs/core/services/hash'
import type { HttpContext } from '@adonisjs/core/http'

export default class AuthController {
  /**
   * Cambia la contraseña del usuario autenticado. El usuario sale del
   * token, nunca del body, y se exige la contraseña actual.
   */
  async updatePassword({ auth, request, response }: HttpContext) {
    const { currentPassword, newPassword } = await request.validateUsing(updatePasswordValidator)
    const user = auth.user!

    if (!(await hash.verify(user.password, currentPassword))) {
      return response.unauthorized({
        status: 'error',
        message: 'La contraseña actual no es correcta',
      })
    }

    user.password = newPassword
    await user.save()

    // Cerramos las demás sesiones: si la contraseña cambió, los tokens
    // emitidos antes dejan de valer.
    const tokens = await User.accessTokens.all(user)
    await Promise.all(
      tokens
        .filter((token) => token.identifier !== user.currentAccessToken.identifier)
        .map((token) => User.accessTokens.delete(user, token.identifier))
    )

    return { status: 'success', message: 'Contraseña actualizada correctamente' }
  }

  /**
   * Registro público de dueños de tienda. El rol lo fija el servidor.
   */
  async register({ request, response }: HttpContext) {
    const data = await request.validateUsing(registerValidator)
    const adminRole = await Role.findBy('name', 'admin')

    if (!adminRole) {
      return response.internalServerError({
        status: 'error',
        message: 'El rol admin no existe. Corre el seeder inicial.',
      })
    }

    const user = await User.create({
      ...data,
      rolId: adminRole.id,
      status: 'activo',
    })

    const token = await User.accessTokens.create(user, ['*'], { expiresIn: '30 days' })

    return response.created({
      status: 'success',
      message: 'Usuario registrado correctamente',
      data: { user, token },
    })
  }

  async login({ request, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.verifyCredentials(email, password)

    if (user.status !== 'activo') {
      return response.forbidden({
        status: 'error',
        message: 'Tu cuenta está inactiva. Contacta al administrador.',
      })
    }

    return User.accessTokens.create(user)
  }

  async logout({ auth }: HttpContext) {
    const user = auth.user!
    await User.accessTokens.delete(user, user.currentAccessToken.identifier)
    return { message: 'success' }
  }

  async me({ auth }: HttpContext) {
    const user = await User.query()
      .where('id', auth.user!.id)
      .preload('role')
      .preload('businesses')
      .firstOrFail()

    return { user }
  }
}
