import Role from '#models/role'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class UsersController {
  public async index({}: HttpContext) {
    try {
      const users = await User.all()
      return {
        status: 'success',
        message: 'users fetched with success',
        data: users,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'users fetch error',
        error,
      }
    }
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
    try {
      const user = await User.findOrFail(params.id)
      return {
        status: 'success',
        message: 'user fetched with success',
        data: user,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'user fetch error',
        error,
      }
    }
  }

  public async store({ request }: HttpContext) {
    try {
      const data = request.only(['name', 'email', 'password', 'rolId', 'status'])

      const user = await User.create(data)
      return {
        status: 'success',
        message: 'user created successfully',
        data: user,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'user store error',
        error,
      }
    }
  }

  public async update({ params, request }: HttpContext) {
    try {
      const user = await User.findOrFail(params.id)
      const data = request.only(['name', 'email', 'password', 'rolId', 'status'])
      user.merge(data)
      await user.save()
      return {
        status: 'success',
        message: 'user updated successfully',
        data: user,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'user update error',
        error,
      }
    }
  }

  public async destroy({ params }: HttpContext) {
    try {
      const user = await User.findOrFail(params.id)
      await user.delete()
      return {
        status: 'success',
        message: 'user deleted successfully',
        data: user,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'user delete error',
        error,
      }
    }
  }
}
