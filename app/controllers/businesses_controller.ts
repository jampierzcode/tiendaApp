import Business from '#models/business'
import User from '#models/user'
import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'

export default class BusinessesController {
  public async index({}: HttpContext) {
    const businesses = await Business.query().preload('user')
    return { status: 'success', data: businesses }
  }

  public async show({ params }: HttpContext) {
    const business = await Business.query().where('id', params.id).preload('user').firstOrFail()
    return { status: 'success', data: business }
  }

  public async store({ request }: HttpContext) {
    const data = request.only(['name', 'description', 'logo_url', 'user_id'])
    const uuid = randomUUID()
    const user = await User.findOrFail(data.user_id)

    const business = await Business.create({
      uuid,
      name: data.name,
      description: data.description,
      logoUrl: data.logo_url,
      userId: user.id,
    })

    return { status: 'success', message: 'Business created successfully', data: business }
  }

  public async update({ params, request }: HttpContext) {
    const business = await Business.findOrFail(params.id)
    const data = request.only(['name', 'description', 'logo_url', 'status'])
    business.merge(data)
    await business.save()
    return { status: 'success', message: 'Business updated', data: business }
  }
  public async getByUser({ auth, response }: HttpContext) {
    try {
      const user = auth.user!

      const businesses = await Business.query().where('user_id', user.id)
      return { status: 'success', data: businesses }
    } catch (error) {
      console.log(error)
      return response.internalServerError({
        status: 'error',
        message: 'Error al obtener empresas del usuario',
        error: error.message,
      })
    }
  }
  public async getByUuid({ params, response }: HttpContext) {
    try {
      const uuid = params.uuid

      const businesses = await Business.query().where('uuid', uuid).firstOrFail()
      return { status: 'success', data: businesses }
    } catch (error) {
      console.log(error)
      return response.internalServerError({
        status: 'error',
        message: 'Error al obtener empresas del usuario',
        error: error.message,
      })
    }
  }

  public async destroy({ params }: HttpContext) {
    const business = await Business.findOrFail(params.id)
    await business.delete()
    return { status: 'success', message: 'Business deleted' }
  }
}
