import type { HttpContext } from '@adonisjs/core/http'

import Role from '#models/role'

export default class RolesController {
  // Listar todos los planes (GET /plans)
  public async index({}: HttpContext) {
    try {
      const roles = await Role.all()
      return {
        status: 'success',
        message: 'sedes fetched with success',
        data: roles,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'roles fetched with error',
        error: error,
      }
    }
  }

  // Mostrar un plan individual por ID (GET /plans/:id)
  public async show({ params }: HttpContext) {
    try {
      console.log(params)
      const rol = await Role.findOrFail(params.id)
      console.log(rol)
      return {
        status: 'success',
        message: 'sedes fetched with success',
        data: rol,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'rol fetched with error',
        error: error,
      }
    }
  }

  // Crear un nuevo rol (POST /plans)
  public async store({ request }: HttpContext) {
    try {
      const data = request.only(['name', 'created_by']) // Asume que estos campos existen
      const rol = await Role.create(data)

      return {
        status: 'success',
        message: 'rol fetched with success',
        data: rol,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'rol store with error',
        error: error,
      }
    }
  }

  // Actualizar un plan existente (PUT /plans/:id)
  public async update({ params, request }: HttpContext) {
    try {
      const rol = await Role.findOrFail(params.id)
      const data = request.only(['name', 'created_by'])
      rol.merge(data)
      await rol.save()

      return {
        status: 'success',
        message: 'rol fetched with success',
        data: rol,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'rol update with error',
        error: error,
      }
    }
  }

  // Eliminar un rol (DELETE /plans/:id)
  public async destroy({ params }: HttpContext) {
    try {
      const rol = await Role.findOrFail(params.id)
      await rol.delete()
      return {
        status: 'success',
        message: 'Rol deleted successfully',
        data: rol,
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'rol destroy error',
        error: error,
      }
    }
  }
}
