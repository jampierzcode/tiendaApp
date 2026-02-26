import BusinessImage from '#models/business_image'
import Business from '#models/business'
import type { HttpContext } from '@adonisjs/core/http'

export default class BusinessImagesController {
  public async index({ auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const images = await BusinessImage.query()
      .where('business_id', business.id)
      .orderBy('id', 'desc')
    return { status: 'success', data: images }
  }

  public async getByBusiness({ params }: HttpContext) {
    const images = await BusinessImage.query()
      .where('business_id', params.businessId)
      .orderBy('id', 'desc')
    return { status: 'success', data: images }
  }

  public async store({ request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const data = request.only(['url', 'name', 'description', 'type', 'status'])
    const image = await BusinessImage.create({ businessId: business.id, ...data })
    return { status: 'success', message: 'Image added', data: image }
  }

  public async update({ params, request, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const image = await BusinessImage.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    image.merge(request.only(['name', 'description', 'status']))
    await image.save()
    return { status: 'success', message: 'Image updated', data: image }
  }

  public async destroy({ params, auth }: HttpContext) {
    const user = auth.user!
    const business = await Business.findByOrFail('user_id', user.id)
    const image = await BusinessImage.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()
    await image.delete()
    return { status: 'success', message: 'Image deleted' }
  }
}
