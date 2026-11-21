import MenuHoyService from '#services/menu_hoy_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * «Menú de hoy» del panel (dueño). Va fuera de /salon a propósito: lo usa
 * cualquier plan, también Carta digital. El personal lo usa desde el PDV
 * (SalonController) con el permiso `carta.hoy`.
 */
export default class MenuHoyController {
  async show({ business }: HttpContext) {
    return { status: 'success', data: await MenuHoyService.pantalla(business.id) }
  }

  async category({ business, params, request }: HttpContext) {
    await MenuHoyService.marcarCategoria(business.id, Number(params.id), Boolean(request.input('dailyMenu')))
    return { status: 'success', data: await MenuHoyService.pantalla(business.id) }
  }

  async product({ business, params, request }: HttpContext) {
    return { status: 'success', data: await MenuHoyService.marcarPlato(business.id, Number(params.id), cambios(request)) }
  }

  async repeat({ business }: HttpContext) {
    const r = await MenuHoyService.repetirUltimo(business.id)
    return { status: 'success', data: { ...r, ...(await MenuHoyService.pantalla(business.id)) } }
  }
}

export function cambios(request: HttpContext['request']) {
  const out: { elegido?: boolean; agotado?: boolean } = {}
  const e = request.input('elegido')
  const a = request.input('agotado')
  if (e !== undefined && e !== null) out.elegido = Boolean(e)
  if (a !== undefined && a !== null) out.agotado = Boolean(a)
  return out
}
