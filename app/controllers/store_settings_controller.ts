import BusinessImage from '#models/business_image'
import SlugService from '#services/slug_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Configuración de la tienda pública: WhatsApp, colores, envío y publicación.
 */
export default class StoreSettingsController {
  public async show({ business }: HttpContext) {
    await business.load('bannerImage')

    return {
      status: 'success',
      data: business,
      publicUrl: `/t/${business.slug}`,
    }
  }

  public async update({ request, business, response }: HttpContext) {
    const data = request.only([
      'slug',
      'name',
      'description',
      'logo_url',
      'whatsapp_phone',
      'whatsapp_message_template',
      'phone',
      'email',
      'address',
      'city',
      'instagram',
      'facebook',
      'tiktok',
      'schedule',
      'primary_color',
      'secondary_color',
      'banner_image_id',
      'currency',
      'currency_symbol',
      'shipping_cost',
      'free_shipping_from',
      'is_public',
    ])

    if (data.slug && data.slug !== business.slug) {
      business.slug = await SlugService.uniqueSlugGlobal('businesses', data.slug, business.id)
    }

    if (data.whatsapp_phone !== undefined) {
      const digitos = String(data.whatsapp_phone ?? '').replace(/\D/g, '')

      if (digitos && digitos.length < 9) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'El número de WhatsApp debe incluir el código de país, por ejemplo 51987654321',
        })
      }

      business.whatsappPhone = digitos || null
    }

    if (data.banner_image_id) {
      const imagen = await BusinessImage.query()
        .where('id', data.banner_image_id)
        .andWhere('business_id', business.id)
        .first()

      if (!imagen) {
        return response.unprocessableEntity({
          status: 'error',
          message: 'La imagen de portada no pertenece a este negocio',
        })
      }
    }

    // Publicar sin número de WhatsApp deja una tienda que no puede vender.
    const quierePublicar = data.is_public === true || data.is_public === 'true'
    if (quierePublicar && !business.whatsappPhone) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Configura el número de WhatsApp antes de publicar la tienda',
      })
    }

    business.merge({
      name: data.name ?? business.name,
      description: data.description ?? business.description,
      logoUrl: data.logo_url ?? business.logoUrl,
      whatsappMessageTemplate: data.whatsapp_message_template ?? business.whatsappMessageTemplate,
      phone: data.phone ?? business.phone,
      email: data.email ?? business.email,
      address: data.address ?? business.address,
      city: data.city ?? business.city,
      instagram: data.instagram ?? business.instagram,
      facebook: data.facebook ?? business.facebook,
      tiktok: data.tiktok ?? business.tiktok,
      schedule: data.schedule ?? business.schedule,
      primaryColor: data.primary_color ?? business.primaryColor,
      secondaryColor: data.secondary_color ?? business.secondaryColor,
      bannerImageId: data.banner_image_id ?? business.bannerImageId,
      currency: data.currency ?? business.currency,
      currencySymbol: data.currency_symbol ?? business.currencySymbol,
      shippingCost: data.shipping_cost ?? business.shippingCost,
      freeShippingFrom:
        data.free_shipping_from === undefined
          ? business.freeShippingFrom
          : data.free_shipping_from === null || data.free_shipping_from === ''
            ? null
            : Number(data.free_shipping_from),
      isPublic: data.is_public === undefined ? business.isPublic : quierePublicar,
    })

    await business.save()

    return {
      status: 'success',
      message: 'Configuración actualizada',
      data: business,
      publicUrl: `/t/${business.slug}`,
    }
  }
}
