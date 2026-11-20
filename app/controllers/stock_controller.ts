import { OrderError } from '#services/order_service'
import StockService from '#services/stock_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Inventario del restaurante (función de plan «insumos»): compras,
 * preparaciones, conteo físico, kardex y reportes. Solo el panel del dueño.
 */
export default class StockController {
  private async manejar(ctx: HttpContext, fn: () => Promise<unknown>) {
    try {
      return { status: 'success', data: await fn() }
    } catch (error) {
      if (error instanceof OrderError) {
        return ctx.response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }

  suppliers = (ctx: HttpContext) => this.manejar(ctx, () => StockService.proveedores(ctx.business))
  createSupplier = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.crearProveedor(ctx.business, ctx.request.only(['name', 'ruc', 'phone']))
    )

  purchases = (ctx: HttpContext) => this.manejar(ctx, () => StockService.compras(ctx.business))
  createPurchase = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.registrarCompra(
        ctx.business,
        ctx.auth.user!.id,
        ctx.request.only(['supplierId', 'document', 'date', 'note', 'lines']) as any
      )
    )
  voidPurchase = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.anularCompra(ctx.business, ctx.auth.user!.id, Number(ctx.params.id))
    )

  components = (ctx: HttpContext) =>
    this.manejar(ctx, () => StockService.componentes(ctx.business, Number(ctx.params.id)))
  saveComponents = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.guardarComponentes(
        ctx.business,
        Number(ctx.params.id),
        ctx.request.only(['yieldQty', 'components']) as any
      )
    )
  produce = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.producir(
        ctx.business,
        ctx.auth.user!.id,
        Number(ctx.params.id),
        ctx.request.input('batches')
      )
    )

  counts = (ctx: HttpContext) => this.manejar(ctx, () => StockService.conteos(ctx.business))
  openCount = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.abrirConteo(
        ctx.business,
        ctx.auth.user!.id,
        ctx.request.only(['category', 'note'])
      )
    )
  count = (ctx: HttpContext) =>
    this.manejar(ctx, () => StockService.conteo(ctx.business, Number(ctx.params.id)))
  saveCount = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.guardarConteo(
        ctx.business,
        Number(ctx.params.id),
        ctx.request.input('values') ?? {}
      )
    )
  closeCount = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.cerrarConteo(ctx.business, ctx.auth.user!.id, Number(ctx.params.id))
    )
  discardCount = (ctx: HttpContext) =>
    this.manejar(ctx, () => StockService.descartarConteo(ctx.business, Number(ctx.params.id)))

  movements = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.movimientos(ctx.business, {
        ingredientId: Number(ctx.request.input('ingredientId')) || undefined,
        type: ctx.request.input('type') || undefined,
        desde: ctx.request.input('desde'),
        hasta: ctx.request.input('hasta'),
      })
    )

  reports = (ctx: HttpContext) =>
    this.manejar(ctx, () =>
      StockService.reportes(ctx.business, ctx.request.input('desde'), ctx.request.input('hasta'))
    )
}
