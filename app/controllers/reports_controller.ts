import ReportService, { ZONA_REPORTES, type Granularidad } from '#services/report_service'
import InventoryService from '#services/inventory_service'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

const GRANULARIDADES = ['day', 'week', 'month'] as const

export default class ReportsController {
  /**
   * Rango pedido, o el mes en curso si no mandan nada.
   *
   * El "hoy" se calcula en la zona del negocio, no en la del servidor. A las
   * 8pm en Lima el servidor en UTC ya está en el día siguiente: si el rango
   * saliera de ahí, las ventas de esta tarde quedarían fuera de su propio día.
   */
  private rango(request: HttpContext['request']) {
    const hoy = DateTime.now().setZone(ZONA_REPORTES)

    return {
      desde: String(request.input('from', hoy.startOf('month').toFormat('yyyy-MM-dd'))),
      hasta: String(request.input('to', hoy.toFormat('yyyy-MM-dd'))),
    }
  }

  /**
   * Todo el tablero en una sola llamada.
   *
   * Son seis consultas que la pantalla necesita juntas: pedirlas por separado
   * haría seis viajes y dejaría los números apareciendo de a poco.
   */
  public async overview({ business, request, response }: HttpContext) {
    const rango = this.rango(request)
    const granularidad = String(request.input('granularity', 'day')) as Granularidad

    if (!GRANULARIDADES.includes(granularidad)) {
      return response.unprocessableEntity({
        status: 'error',
        message: `La granularidad debe ser: ${GRANULARIDADES.join(', ')}`,
      })
    }

    const [resumen, serie, productos, clientes, pagos, estados, bajoStock] = await Promise.all([
      ReportService.resumen(business.id, rango),
      ReportService.serieVentas(business.id, rango, granularidad),
      ReportService.productosTop(business.id, rango, 8),
      ReportService.clientesTop(business.id, rango, 8),
      ReportService.metodosPago(business.id, rango),
      ReportService.pedidosPorEstado(business.id, rango),
      InventoryService.lowStock(business.id),
    ])

    return {
      status: 'success',
      data: {
        rango,
        granularidad,
        resumen,
        serie,
        productos,
        clientes,
        pagos,
        estados,
        alertasStock: bajoStock.slice(0, 10).map((v) => ({
          id: v.id,
          producto: v.product?.name,
          variacion: (v.attributes ?? [])
            .map((a) => a.value?.value)
            .filter(Boolean)
            .join(' · '),
          stock: v.stock,
        })),
        totalAlertas: bajoStock.length,
      },
    }
  }

  public async sales({ business, request }: HttpContext) {
    const granularidad = String(request.input('granularity', 'day')) as Granularidad
    const serie = await ReportService.serieVentas(business.id, this.rango(request), granularidad)
    return { status: 'success', data: serie }
  }

  public async topProducts({ business, request }: HttpContext) {
    const productos = await ReportService.productosTop(
      business.id,
      this.rango(request),
      Number(request.input('limit', 20))
    )
    return { status: 'success', data: productos }
  }
}
