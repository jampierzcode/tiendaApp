import Category from '#models/category'
import DiningTable from '#models/dining_table'
import Printer from '#models/printer'
import PrintJob from '#models/print_job'
import Product from '#models/product'
import ProductionArea from '#models/production_area'
import { OrderError } from '#services/order_service'
import SalonService, { type Actor } from '#services/salon_service'
import StaffService from '#services/staff_service'
import CashService from '#services/cash_service'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

/**
 * PDV de salón. Las rutas de operación (mesas, comandar, cobrar) las usan el
 * dueño y el personal; las de configuración y la central de impresión, solo
 * el dueño.
 */
export default class SalonController {
  private actor(ctx: HttpContext): Actor {
    if (ctx.staff) {
      return { userId: ctx.staff.userId, name: ctx.staff.name, role: ctx.staff.role }
    }
    return { userId: ctx.auth.user!.id, name: ctx.auth.user!.name || 'Dueño', role: 'dueno' }
  }

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

  private soloDueno(ctx: HttpContext) {
    if (ctx.staff) {
      ctx.response.forbidden({ status: 'error', message: 'Solo el dueño puede hacer esto' })
      return false
    }
    return true
  }

  // ------------------------------------------------------------- operación

  async me(ctx: HttpContext) {
    const a = this.actor(ctx)
    return {
      status: 'success',
      data: {
        name: a.name,
        role: a.role,
        puedeCobrar: SalonService.puedeCobrar(a),
        negocio: { name: ctx.business.name, uuid: ctx.business.uuid, simbolo: ctx.business.currencySymbol || 'S/' },
      },
    }
  }

  async tables(ctx: HttpContext) {
    return this.manejar(ctx, () => SalonService.mesas(ctx.business))
  }

  async menu(ctx: HttpContext) {
    return this.manejar(ctx, () => SalonService.menu(ctx.business))
  }

  async account(ctx: HttpContext) {
    return this.manejar(ctx, () => SalonService.cuenta(ctx.business, Number(ctx.params.id)))
  }

  async command(ctx: HttpContext) {
    const body = ctx.request.only(['tableId', 'clientRequestId', 'guests', 'items'])
    return this.manejar(ctx, () => SalonService.comandar(ctx.business, this.actor(ctx), body as any))
  }

  async voidItem(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      SalonService.anularItem(ctx.business, this.actor(ctx), Number(ctx.params.itemId), {
        reason: ctx.request.input('reason'),
        quantity: ctx.request.input('quantity'),
      })
    )
  }

  async preBill(ctx: HttpContext) {
    return this.manejar(ctx, () => SalonService.precuenta(ctx.business, this.actor(ctx), Number(ctx.params.id)))
  }

  async pay(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      SalonService.cobrar(ctx.business, this.actor(ctx), Number(ctx.params.id), {
        payments: ctx.request.input('payments') ?? [],
        discountPercentage: ctx.request.input('discountPercentage'),
        customerName: ctx.request.input('customerName'),
      })
    )
  }

  async cancel(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      SalonService.cancelarCuenta(ctx.business, this.actor(ctx), Number(ctx.params.id), ctx.request.input('reason'))
    )
  }

  async move(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      SalonService.moverMesa(ctx.business, this.actor(ctx), Number(ctx.params.id), Number(ctx.request.input('tableId')))
    )
  }

  // ------------------------------------------------------------------- caja

  async cashState(ctx: HttpContext) {
    return this.manejar(ctx, () => CashService.estado(ctx.business, this.actor(ctx)))
  }

  async cashOpen(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      CashService.abrir(ctx.business, this.actor(ctx), {
        registerId: ctx.request.input('registerId'),
        openingFloat: ctx.request.input('openingFloat'),
      })
    )
  }

  async cashRegister(ctx: HttpContext) {
    return this.manejar(ctx, () => CashService.crearCaja(ctx.business, this.actor(ctx), ctx.request.input('name')))
  }

  async cashMovement(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      CashService.movimiento(ctx.business, this.actor(ctx), Number(ctx.params.id), {
        type: ctx.request.input('type'),
        amount: ctx.request.input('amount'),
        reason: ctx.request.input('reason'),
      })
    )
  }

  async cashX(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      CashService.corteX(ctx.business, this.actor(ctx), Number(ctx.params.id), ctx.request.input('print') !== false)
    )
  }

  async cashZ(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      CashService.corteZ(ctx.business, this.actor(ctx), Number(ctx.params.id), {
        declared: ctx.request.input('declared') ?? {},
        note: ctx.request.input('note'),
      })
    )
  }

  async cashClose(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      CashService.cierreGlobal(ctx.business, this.actor(ctx), { force: ctx.request.input('force') === true })
    )
  }

  async cashHistory(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, () => CashService.historial(ctx.business))
  }

  async cashReprint(ctx: HttpContext) {
    return this.manejar(ctx, () => CashService.reimprimirGlobal(ctx.business, this.actor(ctx), Number(ctx.params.id)))
  }

  // ----------------------------------------------------- central de impresión

  /** Trabajos por imprimir (los últimos 12 h, hasta 5 intentos). */
  async printQueue(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const jobs = await PrintJob.query()
      .where('business_id', ctx.business.id)
      .whereIn('status', ['pendiente', 'error'])
      .andWhere('attempts', '<', 5)
      .andWhere('created_at', '>', DateTime.now().minus({ hours: 12 }).toSQL()!)
      .orderBy('id', 'asc')
      .limit(30)
    const printers = await Printer.query().where('business_id', ctx.business.id)
    return { status: 'success', data: { jobs, printers } }
  }

  async printResult(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const job = await PrintJob.query()
      .where('business_id', ctx.business.id)
      .andWhere('id', Number(ctx.params.jobId))
      .firstOrFail()
    const ok = ctx.request.input('ok') === true
    job.attempts += 1
    job.status = ok ? 'impreso' : 'error'
    job.error = ok ? null : String(ctx.request.input('error') ?? 'Error').slice(0, 255)
    job.printedAt = ok ? DateTime.now() : null
    await job.save()
    return { status: 'success', data: job }
  }

  /** Historial reciente, para reimprimir. */
  async printHistory(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const jobs = await PrintJob.query()
      .where('business_id', ctx.business.id)
      .orderBy('id', 'desc')
      .limit(40)
    return { status: 'success', data: jobs }
  }

  async reprint(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const job = await PrintJob.query()
      .where('business_id', ctx.business.id)
      .andWhere('id', Number(ctx.params.jobId))
      .firstOrFail()
    job.status = 'pendiente'
    job.attempts = 0
    job.error = null
    await job.save()
    return { status: 'success', data: job }
  }

  async testPrint(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const printerId = Number(ctx.request.input('printerId')) || null
    const job = await SalonService.encolar(null, ctx.business, {
      kind: 'prueba',
      printerId,
      orderId: null,
      payload: { negocio: ctx.business.name },
    })
    return { status: 'success', data: job }
  }

  // ---------------------------------------------------------- configuración

  async config(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const b = ctx.business.id
    const [printers, areas, tables, staff, categories, products] = await Promise.all([
      Printer.query().where('business_id', b).orderBy('id', 'asc'),
      ProductionArea.query().where('business_id', b).orderBy('sort_order', 'asc').orderBy('id', 'asc'),
      DiningTable.query().where('business_id', b).orderBy('sort_order', 'asc').orderBy('id', 'asc'),
      StaffService.listar(ctx.business),
      Category.query().where('business_id', b).orderBy('sort_order', 'asc').select('id', 'name', 'production_area_id'),
      Product.query()
        .where('business_id', b)
        .andWhere('status', 'activo')
        .preload('categoryLinks')
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .select('id', 'name', 'production_area_id'),
    ])
    return {
      status: 'success',
      data: {
        printers,
        areas,
        tables,
        staff,
        categories: categories.map((c) => ({ id: c.id, name: c.name, productionAreaId: c.productionAreaId })),
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          productionAreaId: p.productionAreaId,
          categoryIds: p.categoryLinks.map((l) => l.categoryId),
        })),
      },
    }
  }

  async savePrinter(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const p = id
        ? await Printer.query().where('business_id', ctx.business.id).andWhere('id', id).firstOrFail()
        : new Printer()
      const name = String(ctx.request.input('name', p.name ?? '')).trim().slice(0, 60)
      if (!name) throw new OrderError('Escribe un nombre')
      p.merge({
        businessId: ctx.business.id,
        name,
        paperWidth: Number(ctx.request.input('paperWidth', p.paperWidth ?? 58)) === 80 ? 80 : 58,
        isActive: ctx.request.input('isActive', p.isActive ?? true) !== false,
      })
      await p.save()
      return p
    })
  }

  async deletePrinter(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    await Printer.query().where('business_id', ctx.business.id).andWhere('id', Number(ctx.params.id)).delete()
    return { status: 'success' }
  }

  async saveArea(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const a = id
        ? await ProductionArea.query().where('business_id', ctx.business.id).andWhere('id', id).firstOrFail()
        : new ProductionArea()
      const name = String(ctx.request.input('name', a.name ?? '')).trim().slice(0, 60)
      if (!name) throw new OrderError('Escribe un nombre')
      const printerId = ctx.request.input('printerId', a.printerId ?? null)
      if (printerId) {
        await Printer.query().where('business_id', ctx.business.id).andWhere('id', Number(printerId)).firstOrFail()
      }
      a.merge({
        businessId: ctx.business.id,
        name,
        printerId: printerId ? Number(printerId) : null,
        sortOrder: Number(ctx.request.input('sortOrder', a.sortOrder ?? 0)) || 0,
        isActive: ctx.request.input('isActive', a.isActive ?? true) !== false,
      })
      await a.save()
      return a
    })
  }

  async deleteArea(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    await ProductionArea.query()
      .where('business_id', ctx.business.id)
      .andWhere('id', Number(ctx.params.id))
      .delete()
    return { status: 'success' }
  }

  /** Asigna áreas en bloque: { categories: {id: areaId|null}, products: {id: areaId|null} }. */
  async assignAreas(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const b = ctx.business.id
      const validas = new Set(
        (await ProductionArea.query().where('business_id', b).select('id')).map((a) => a.id)
      )
      const limpiar = (v: unknown) => {
        const n = Number(v)
        if (!v || !n) return null
        if (!validas.has(n)) throw new OrderError('Área no válida')
        return n
      }
      const cats = (ctx.request.input('categories') ?? {}) as Record<string, unknown>
      for (const [id, area] of Object.entries(cats)) {
        await Category.query().where('business_id', b).andWhere('id', Number(id)).update({ production_area_id: limpiar(area) })
      }
      const prods = (ctx.request.input('products') ?? {}) as Record<string, unknown>
      for (const [id, area] of Object.entries(prods)) {
        await Product.query().where('business_id', b).andWhere('id', Number(id)).update({ production_area_id: limpiar(area) })
      }
      return { ok: true }
    })
  }

  async saveTable(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const t = id
        ? await DiningTable.query().where('business_id', ctx.business.id).andWhere('id', id).firstOrFail()
        : new DiningTable()
      const name = String(ctx.request.input('name', t.name ?? '')).trim().slice(0, 40)
      if (!name) throw new OrderError('Escribe el nombre o número de la mesa')
      const zone = ctx.request.input('zone', t.zone ?? null)
      const seats = ctx.request.input('seats', t.seats ?? null)
      t.merge({
        businessId: ctx.business.id,
        name,
        zone: zone ? String(zone).trim().slice(0, 40) : null,
        seats: seats ? Math.max(1, Number(seats)) : null,
        sortOrder: Number(ctx.request.input('sortOrder', t.sortOrder ?? 0)) || 0,
        isActive: ctx.request.input('isActive', t.isActive ?? true) !== false,
      })
      await t.save()
      return t
    })
  }

  /** Crea varias mesas de una: "Mesa 1" … "Mesa N". */
  async bulkTables(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const cantidad = Math.floor(Number(ctx.request.input('count')))
      if (!cantidad || cantidad < 1 || cantidad > 100) throw new OrderError('Entre 1 y 100 mesas')
      const prefijo = String(ctx.request.input('prefix', '') ?? '').trim().slice(0, 20)
      const zone = String(ctx.request.input('zone', '') ?? '').trim().slice(0, 40) || null
      const existentes = await DiningTable.query().where('business_id', ctx.business.id).count('* as n')
      const base = Number(existentes[0].$extras.n)
      const creadas = []
      for (let i = 1; i <= cantidad; i++) {
        creadas.push(
          await DiningTable.create({
            businessId: ctx.business.id,
            name: prefijo ? `${prefijo} ${i}` : String(base + i),
            zone,
            sortOrder: base + i,
            isActive: true,
          })
        )
      }
      return creadas
    })
  }

  async deleteTable(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const t = await DiningTable.query()
        .where('business_id', ctx.business.id)
        .andWhere('id', Number(ctx.params.id))
        .firstOrFail()
      const abierta = await (await import('#models/order')).default
        .query()
        .where('dining_table_id', t.id)
        .andWhere('status', 'abierta')
        .first()
      if (abierta) throw new OrderError('La mesa tiene una cuenta abierta')
      await t.delete()
      return { ok: true }
    })
  }

  async saveStaff(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const datos = ctx.request.only(['name', 'pin', 'role', 'isActive'])
      return id ? StaffService.actualizar(ctx.business, id, datos) : StaffService.crear(ctx.business, datos as any)
    })
  }

  async deleteStaff(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    await StaffService.eliminar(ctx.business, Number(ctx.params.id))
    return { status: 'success' }
  }
}

/** Entrada del personal con PIN — pública, sin token. */
export class StaffAuthController {
  async list({ params, response }: HttpContext) {
    const data = await StaffService.publicos(params.businessUuid)
    if (!data) return response.notFound({ status: 'error', message: 'Negocio no encontrado' })
    return { status: 'success', data }
  }

  async login({ params, request, response }: HttpContext) {
    try {
      const { token, staff } = await StaffService.entrar(
        params.businessUuid,
        Number(request.input('staffId')),
        request.input('pin')
      )
      return { status: 'success', data: { token: token.toJSON(), name: staff.name, role: staff.role } }
    } catch (error) {
      if (error instanceof OrderError) {
        return response.unprocessableEntity({ status: 'error', message: error.message })
      }
      throw error
    }
  }
}
