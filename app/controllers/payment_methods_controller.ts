import PaymentMethodService from '#services/payment_method_service'
import StorageService from '#services/storage_service'
import type { HttpContext } from '@adonisjs/core/http'

/** Métodos de pago de la tienda (Mi tienda → Métodos de pago). */
export default class PaymentMethodsController {
  private static servir(lista: ReturnType<typeof PaymentMethodService.todos>) {
    return lista.map((m) => ({
      ...m,
      imagenes: m.imagenes.map((i) => ({ ...i, url: StorageService.urlAbsoluta(i.url) })),
    }))
  }

  public async index({ business }: HttpContext) {
    return {
      status: 'success',
      data: PaymentMethodsController.servir(PaymentMethodService.todos(business)),
      // Texto libre de antes (Mi tienda → General), para pasarlo a un método o borrarlo.
      legacyInstructions: business.paymentInstructions,
    }
  }

  public async update({ business, request }: HttpContext) {
    const lista = await PaymentMethodService.limpiar(business, request.input('methods'))
    business.paymentMethods = JSON.stringify(lista)
    if (request.input('clearLegacy') === true) business.paymentInstructions = null
    await business.save()
    return {
      status: 'success',
      message: 'Métodos de pago guardados',
      data: PaymentMethodsController.servir(lista),
      legacyInstructions: business.paymentInstructions,
    }
  }
}
