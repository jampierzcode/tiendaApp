import Role from '#models/role'
import User from '#models/user'
import OnboardingService, { TRIAL_DAYS } from '#services/onboarding_service'
import { CATALOG_TEMPLATES } from '#services/templates/catalog_templates'
import { addBusinessValidator, subscribeValidator } from '#validators/auth'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Suscripción self-service: el cliente configura su negocio con un wizard y
 * sale con la plataforma lista y 7 días de prueba.
 */
export default class SubscriptionsController {
  /** Rubros y plantillas disponibles; alimenta el paso "Tu negocio" del wizard. */
  async templates() {
    return {
      status: 'success',
      data: {
        trial_days: TRIAL_DAYS,
        templates: CATALOG_TEMPLATES.map((t) => ({
          key: t.key,
          business_type: t.businessType,
          label: t.label,
          description: t.description,
          categories: t.categories.length,
          products: t.categories.reduce((n, c) => n + c.products.length, 0),
          sample: t.categories.flatMap((c) => c.products).slice(0, 4).map((p) => p.name),
        })),
      },
    }
  }

  /** Alta pública: crea el dueño (rol admin) y su primer negocio. */
  async subscribe({ request, response }: HttpContext) {
    const { owner, business } = await request.validateUsing(subscribeValidator)

    const adminRole = await Role.findBy('name', 'admin')
    if (!adminRole) {
      return response.internalServerError({
        status: 'error',
        message: 'El rol admin no existe. Corre el seeder inicial.',
      })
    }

    const user = await User.create({
      name: owner.name,
      email: owner.email,
      password: owner.password,
      rolId: adminRole.id,
      status: 'activo',
    })

    try {
      const { business: created, products } = await OnboardingService.createBusiness(user, business)
      const token = await User.accessTokens.create(user, ['*'], { expiresIn: '30 days' })

      return response.created({
        status: 'success',
        message: 'Cuenta creada. Tu prueba gratis de 7 días ya está activa.',
        data: { user, token, business: created, products },
      })
    } catch (error) {
      // El negocio no se creó (transacción revertida): no dejamos un usuario
      // huérfano que luego no pueda volver a registrarse con el mismo correo.
      await user.delete()
      return response.unprocessableEntity({ status: 'error', message: (error as Error).message })
    }
  }

  /** Un usuario con sesión agrega otro negocio (multi-tenant): ropa, repuestos, otro local. */
  async addBusiness({ request, auth, response }: HttpContext) {
    const input = await request.validateUsing(addBusinessValidator)

    try {
      const { business, products } = await OnboardingService.createBusiness(auth.user!, input)
      return response.created({
        status: 'success',
        message: 'Negocio creado con 7 días de prueba gratis.',
        data: { business, products },
      })
    } catch (error) {
      return response.unprocessableEntity({ status: 'error', message: (error as Error).message })
    }
  }
}
