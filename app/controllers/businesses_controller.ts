import Business from '#models/business'
import User from '#models/user'
import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'

export default class BusinessesController {
  /**
   * ¿Puede este usuario tocar este negocio? El superadmin sí; el resto solo
   * los suyos.
   */
  private async canManage(auth: HttpContext['auth'], business: Business) {
    const user = auth.user!
    await user.load('role')
    return user.role?.name === 'superadmin' || business.userId === user.id
  }

  /** Listado global. Solo superadmin (lo impone el middleware de rol). */
  public async index({}: HttpContext) {
    const businesses = await Business.query().preload('user').orderBy('id', 'desc')
    return { status: 'success', data: businesses }
  }

  public async show({ params, auth, response }: HttpContext) {
    const business = await Business.query().where('id', params.id).preload('user').firstOrFail()

    if (!(await this.canManage(auth, business))) {
      return response.forbidden({ status: 'error', message: 'No tienes acceso a este negocio' })
    }

    return { status: 'success', data: business }
  }

  public async store({ request, auth, response }: HttpContext) {
    const data = request.only(['name', 'description', 'logo_url', 'user_id'])
    const user = auth.user!
    await user.load('role')
    const isSuperAdmin = user.role?.name === 'superadmin'

    // Solo el superadmin puede crear un negocio a nombre de otro usuario.
    const ownerId = isSuperAdmin && data.user_id ? Number(data.user_id) : user.id
    const owner = await User.find(ownerId)

    if (!owner) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'El usuario indicado no existe',
      })
    }

    const business = await Business.create({
      uuid: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      logoUrl: data.logo_url ?? null,
      userId: owner.id,
      status: 'activo',
    })

    return response.created({ status: 'success', message: 'Negocio creado', data: business })
  }

  public async update({ params, request, auth, response }: HttpContext) {
    const business = await Business.findOrFail(params.id)

    if (!(await this.canManage(auth, business))) {
      return response.forbidden({ status: 'error', message: 'No tienes acceso a este negocio' })
    }

    const user = auth.user!
    await user.load('role')
    const isSuperAdmin = user.role?.name === 'superadmin'

    const data = request.only(['name', 'description', 'logo_url', 'status'])

    business.merge({
      name: data.name ?? business.name,
      description: data.description ?? business.description,
      logoUrl: data.logo_url ?? business.logoUrl,
      // Dar de baja un negocio es decisión del superadmin, no de su dueño.
      status: isSuperAdmin && data.status ? data.status : business.status,
    })

    await business.save()

    return { status: 'success', message: 'Negocio actualizado', data: business }
  }

  /** Negocios del usuario autenticado. Alimenta el selector del panel. */
  public async getByUser({ auth }: HttpContext) {
    const businesses = await Business.query()
      .where('user_id', auth.user!.id)
      .orderBy('id', 'asc')

    return { status: 'success', data: businesses }
  }

  public async getByUuid({ params, auth, response }: HttpContext) {
    const business = await Business.findBy('uuid', params.uuid)

    if (!business) {
      return response.notFound({ status: 'error', message: 'Negocio no encontrado' })
    }

    if (!(await this.canManage(auth, business))) {
      return response.forbidden({ status: 'error', message: 'No tienes acceso a este negocio' })
    }

    return { status: 'success', data: business }
  }

  /** Borrar arrastra productos, categorías e imágenes: solo superadmin. */
  public async destroy({ params }: HttpContext) {
    const business = await Business.findOrFail(params.id)
    await business.delete()

    return { status: 'success', message: 'Negocio eliminado' }
  }
}
