import PriceService, { PriceError } from '#services/price_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Revisión de precios. Ningún método cambia un precio sin `confirm: true`:
 * sin él se devuelve la vista previa para que el dueño decida.
 */
export default class PriceReviewsController {
  public async index({ business }: HttpContext) {
    return { status: 'success', data: await PriceService.pendientes(business) }
  }

  public async dismiss({ params, business, auth, response }: HttpContext) {
    try {
      const revision = await PriceService.descartar(business, Number(params.id), auth.user!.id)
      return { status: 'success', message: 'Revisión descartada', data: revision }
    } catch (error) {
      if (error instanceof PriceError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Precio sugerido para un costo (por ejemplo, el de la compra que se registra). */
  public async suggestion({ params, business, request }: HttpContext) {
    const data = await PriceService.sugerencia(business, Number(params.id), Number(request.input('cost')))
    return { status: 'success', data }
  }

  /** Cambia el precio único del producto y de todas sus variaciones. */
  public async apply({ params, business, auth, request, response }: HttpContext) {
    try {
      const resultado = await PriceService.aplicar(
        business,
        Number(params.id),
        Number(request.input('price')),
        { confirm: request.input('confirm') === true, userId: auth.user!.id }
      )

      if (!resultado.aplicado) {
        return {
          status: 'success',
          requiresConfirmation: true,
          message: 'Confirma para cambiar el precio. Las ventas pasadas no se modifican.',
          data: resultado.vista,
        }
      }
      return { status: 'success', message: 'Precio actualizado', data: resultado.vista }
    } catch (error) {
      if (error instanceof PriceError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }
}
