import Role from '#models/role'
import User from '#models/user'
import { createUserValidator } from '#validators/auth'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Gestión de usuarios. Todas las rutas están restringidas a superadmin
 * desde el archivo de rutas.
 */
export default class UsersController {
  public async index({ request }: HttpContext) {
    const search = request.input('search')

    const query = User.query().preload('role').preload('businesses').orderBy('id', 'desc')

    if (search) {
      query.where((sub) => {
        sub.whereILike('name', `%${search}%`).orWhereILike('email', `%${search}%`)
      })
    }

    return { status: 'success', data: await query }
  }

  public async admins({}: HttpContext) {
    const role = await Role.findByOrFail('name', 'admin')

    const users = await User.query()
      .where('rol_id', role.id)
      .select(['id', 'name', 'email', 'rol_id'])
      .preload('role')

    return { status: 'success', data: users }
  }

  public async show({ params }: HttpContext) {
    const user = await User.query()
      .where('id', params.id)
      .preload('role')
      .preload('businesses')
      .firstOrFail()

    return { status: 'success', data: user }
  }

  public async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createUserValidator)

    const user = await User.create({
      name: data.name,
      email: data.email,
      password: data.password,
      rolId: data.rol_id,
      status: data.status ?? 'activo',
    })

    return response.created({ status: 'success', message: 'Usuario creado', data: user })
  }

  public async update({ params, request, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const data = request.only(['name', 'email', 'password', 'rolId', 'rol_id', 'status'])

    if (data.email && data.email !== user.email) {
      const taken = await User.query().where('email', data.email).whereNot('id', user.id).first()

      if (taken) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'Ese correo ya está en uso',
        })
      }
      user.email = data.email
    }

    user.merge({
      name: data.name ?? user.name,
      rolId: data.rol_id ?? data.rolId ?? user.rolId,
      status: data.status ?? user.status,
    })

    // El hook del modelo se encarga de hashearla.
    if (data.password) {
      user.password = data.password
    }

    await user.save()

    return { status: 'success', message: 'Usuario actualizado', data: user }
  }

  public async destroy({ params, auth, response }: HttpContext) {
    const user = await User.findOrFail(params.id)

    if (user.id === auth.user!.id) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'No puedes eliminar tu propia cuenta',
      })
    }

    await user.delete()

    return { status: 'success', message: 'Usuario eliminado' }
  }
}
