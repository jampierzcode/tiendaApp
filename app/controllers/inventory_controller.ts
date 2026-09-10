import StockMovement from '#models/stock_movement'
import InventoryService, { InsufficientStockError } from '#services/inventory_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Kardex del negocio: historial de movimientos, ajustes manuales y alertas
 * de stock bajo.
 */
export default class InventoryController {
  /** Historial de movimientos, del más reciente al más antiguo. */
  public async movements({ business, request }: HttpContext) {
    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 30))
    const variationId = request.input('variationId')
    const type = request.input('type')

    const query = StockMovement.query()
      .where('business_id', business.id)
      .preload('user', (u) => u.select('id', 'name'))
      .preload('variation', (v) => {
        v.preload('product', (p) => p.select('id', 'name', 'sku'))
        v.preload('attributes', (a) => a.preload('value'))
      })
      .orderBy('id', 'desc')

    if (variationId) {
      query.where('product_variation_id', variationId)
    }

    if (type) {
      query.where('type', type)
    }

    const movements = await query.paginate(page, perPage)

    return { status: 'success', ...movements.toJSON() }
  }

  /**
   * Ajuste manual de inventario. Fija el saldo a un valor absoluto y deja la
   * diferencia registrada en el kardex, con motivo y autor.
   */
  public async adjust({ request, business, auth, response }: HttpContext) {
    const variationId = Number(request.input('variationId'))
    const newStock = Number(request.input('newStock'))
    const note = request.input('note')

    if (!variationId || Number.isNaN(newStock)) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Se requieren variationId y newStock',
      })
    }

    if (newStock < 0) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'El stock no puede ser negativo',
      })
    }

    const result = await InventoryService.setStock({
      businessId: business.id,
      variationId,
      newStock,
      note: note ?? null,
      userId: auth.user!.id,
    })

    return { status: 'success', message: 'Inventario ajustado', data: result }
  }

  /**
   * Entrada o salida puntual: merma, devolución o ingreso suelto.
   */
  public async move({ request, business, auth, response }: HttpContext) {
    const variationId = Number(request.input('variationId'))
    const quantity = Number(request.input('quantity'))
    const type = request.input('type')
    const allowed = ['compra', 'devolucion', 'merma', 'ajuste']

    if (!allowed.includes(type)) {
      return response.unprocessableEntity({
        status: 'error',
        message: `El tipo debe ser uno de: ${allowed.join(', ')}`,
      })
    }

    if (!variationId || !quantity) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Se requieren variationId y quantity',
      })
    }

    try {
      const result = await InventoryService.applyMovement({
        businessId: business.id,
        variationId,
        type,
        quantity,
        unitCost: request.input('unitCost') ?? null,
        note: request.input('note') ?? null,
        userId: auth.user!.id,
      })

      return { status: 'success', message: 'Movimiento registrado', data: result }
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  /** Variaciones en o por debajo del mínimo del producto. */
  public async lowStock({ business }: HttpContext) {
    const variations = await InventoryService.lowStock(business.id)
    return { status: 'success', data: variations }
  }
}
