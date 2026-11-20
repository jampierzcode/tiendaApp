import CashRegister from '#models/cash_register'
import Category from '#models/category'
import DiningTable from '#models/dining_table'
import Order from '#models/order'
import Printer from '#models/printer'
import PrintJob from '#models/print_job'
import Product from '#models/product'
import ProductionArea from '#models/production_area'
import CashService from '#services/cash_service'
import FolioService from '#services/folio_service'
import { OrderError } from '#services/order_service'
import PermissionService, { AutorizacionRequerida, type Actor } from '#services/permission_service'
import PosSettingsService, {
  PERMISOS,
  ROLES_POS,
  type RolPos,
} from '#services/pos_settings_service'
import SalonService from '#services/salon_service'
import KitchenService, { type EstadoCocina } from '#services/kitchen_service'
import Business from '#models/business'
import StaffService from '#services/staff_service'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

/**
 * PDV de salón. Operación (mesas, cuentas, cobro, caja) para el dueño y el
 * personal según sus permisos; central de impresión e infraestructura solo
 * para el dueño.
 */
export default class SalonController {
  private async actor(ctx: HttpContext): Promise<Actor> {
    if (ctx.staff) {
      const equipo = await StaffService.equipoDeToken(
        String(ctx.auth.user!.currentAccessToken.identifier)
      )
      return {
        userId: ctx.staff.userId,
        name: ctx.staff.name,
        role: ctx.staff.role as RolPos,
        permisos: await PermissionService.permisosDeRol(ctx.business, ctx.staff.role as RolPos),
        deviceId: equipo?.id ?? null,
        cashRegisterId: equipo?.cash_register_id ?? null,
      }
    }
    return {
      userId: ctx.auth.user!.id,
      name: ctx.auth.user!.name || 'Dueño',
      role: 'dueno',
      permisos: await PermissionService.permisosDeRol(ctx.business, 'dueno'),
    }
  }

  /** PIN de un superior para autorizar (cabecera o cuerpo). */
  private pin(ctx: HttpContext) {
    return ctx.request.header('x-autorizacion-pin') || ctx.request.input('pin') || null
  }

  private async manejar(ctx: HttpContext, fn: (actor: Actor) => Promise<unknown>) {
    try {
      return { status: 'success', data: await fn(await this.actor(ctx)) }
    } catch (error) {
      if (error instanceof AutorizacionRequerida) {
        return ctx.response.forbidden({
          status: 'error',
          code: 'autorizacion_requerida',
          permiso: error.permiso,
          message: error.message,
        })
      }
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
    return this.manejar(ctx, async (a) => {
      const ajustes = await PosSettingsService.leer(ctx.business)
      const caja = a.cashRegisterId ? await CashRegister.find(a.cashRegisterId) : null
      return {
        name: a.name,
        role: a.role,
        permisos: a.permisos,
        caja: caja ? { id: caja.id, name: caja.name } : null,
        servicios: ajustes.servicios,
        inactividadSegundos: ajustes.inactividadSegundos,
        liberarMesaManual: ajustes.liberarMesaManual,
        negocio: {
          name: ctx.business.name,
          uuid: ctx.business.uuid,
          simbolo: ctx.business.currencySymbol || 'S/',
        },
      }
    })
  }

  async tables(ctx: HttpContext) {
    return this.manejar(ctx, (a) => SalonService.mesas(ctx.business, a))
  }

  async accounts(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.cuentas(ctx.business, a, {
        q: ctx.request.input('q'),
        cerradas: ['1', 'true'].includes(String(ctx.request.input('cerradas', ''))),
      })
    )
  }

  async menu(ctx: HttpContext) {
    return this.manejar(ctx, () => SalonService.menu(ctx.business))
  }

  async account(ctx: HttpContext) {
    return this.manejar(ctx, (a) => SalonService.cuenta(ctx.business, a, Number(ctx.params.id)))
  }

  async command(ctx: HttpContext) {
    const body = ctx.request.only([
      'tableId',
      'orderId',
      'service',
      'alias',
      'customerName',
      'customerPhone',
      'deliveryAddress',
      'shippingCost',
      'clientRequestId',
      'guests',
      'items',
    ])
    return this.manejar(ctx, (a) => SalonService.comandar(ctx.business, a, body as any))
  }

  async inProgress(ctx: HttpContext) {
    const servicio = ctx.request.input('service') === 'delivery' ? 'delivery' : 'para_llevar'
    return this.manejar(ctx, (a) => SalonService.enCurso(ctx.business, a, servicio))
  }

  async dispatch(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.despachar(ctx.business, a, Number(ctx.params.id), ctx.request.input('courier'))
    )
  }

  async deliver(ctx: HttpContext) {
    return this.manejar(ctx, (a) => SalonService.entregar(ctx.business, a, Number(ctx.params.id)))
  }

  async customers(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      SalonService.buscarClientes(ctx.business, ctx.request.input('q'))
    )
  }

  async printAccount(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.imprimirCuenta(ctx.business, a, Number(ctx.params.id), { pin: this.pin(ctx) })
    )
  }

  async reopen(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.reabrir(ctx.business, a, Number(ctx.params.id), { pin: this.pin(ctx) })
    )
  }

  async voidItem(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.anularItem(ctx.business, a, Number(ctx.params.itemId), {
        reason: ctx.request.input('reason'),
        quantity: ctx.request.input('quantity'),
        pin: this.pin(ctx),
      })
    )
  }

  async courtesy(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.cortesia(ctx.business, a, Number(ctx.params.itemId), {
        reason: ctx.request.input('reason'),
        quantity: ctx.request.input('quantity'),
        pin: this.pin(ctx),
      })
    )
  }

  async pay(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.cobrar(ctx.business, a, Number(ctx.params.id), {
        payments: ctx.request.input('payments') ?? [],
        discountPercentage: ctx.request.input('discountPercentage'),
        discountReason: ctx.request.input('discountReason'),
        customerName: ctx.request.input('customerName'),
        pin: this.pin(ctx),
      })
    )
  }

  async reprintNote(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.reimprimirNota(ctx.business, a, Number(ctx.params.id), { pin: this.pin(ctx) })
    )
  }

  async reprintRound(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.reimprimirComanda(ctx.business, a, Number(ctx.params.roundId), {
        pin: this.pin(ctx),
      })
    )
  }

  async cancel(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.cancelarCuenta(
        ctx.business,
        a,
        Number(ctx.params.id),
        ctx.request.input('reason'),
        {
          pin: this.pin(ctx),
        }
      )
    )
  }

  async move(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.moverMesa(
        ctx.business,
        a,
        Number(ctx.params.id),
        Number(ctx.request.input('tableId')),
        {
          pin: this.pin(ctx),
        }
      )
    )
  }

  async releaseTable(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      SalonService.liberarMesa(ctx.business, a, Number(ctx.params.id), { pin: this.pin(ctx) })
    )
  }

  // -------------------------------------------------------------- producción

  /** Monitor de producción desde el panel o un equipo con sesión (todas o algunas áreas). */
  async monitor(ctx: HttpContext) {
    const areas = String(ctx.request.input('areas', '') ?? '')
      .split(',')
      .map(Number)
      .filter(Boolean)
    return this.manejar(ctx, () =>
      KitchenService.tickets(ctx.business, areas.length ? areas : null)
    )
  }

  async monitorItems(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      KitchenService.cambiar(
        ctx.business,
        ctx.request.input('ids') ?? [],
        ctx.request.input('estado') as EstadoCocina
      )
    )
  }

  /** El mesero marca como servidos los platos que ya llevó a la mesa. */
  async serve(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      KitchenService.servir(ctx.business, ctx.request.input('ids') ?? [])
    )
  }

  // ------------------------------------------------------------------- caja

  async cashState(ctx: HttpContext) {
    return this.manejar(ctx, (a) => CashService.estado(ctx.business, a))
  }

  async cashOpen(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.abrir(ctx.business, a, {
        registerId: ctx.request.input('registerId'),
        openingFloat: ctx.request.input('openingFloat'),
        pin: this.pin(ctx),
      })
    )
  }

  async cashMovement(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.movimiento(ctx.business, a, Number(ctx.params.id), {
        type: ctx.request.input('type'),
        amount: ctx.request.input('amount'),
        reason: ctx.request.input('reason'),
        pin: this.pin(ctx),
      })
    )
  }

  async cashX(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.corteX(
        ctx.business,
        a,
        Number(ctx.params.id),
        ctx.request.input('print') !== false,
        this.pin(ctx)
      )
    )
  }

  async cashZ(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.corteZ(ctx.business, a, Number(ctx.params.id), {
        declared: ctx.request.input('declared') ?? {},
        note: ctx.request.input('note'),
        pin: this.pin(ctx),
      })
    )
  }

  async cashCollector(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.recibirDeMesero(ctx.business, a, Number(ctx.params.id), {
        userId: Number(ctx.request.input('userId')),
        declared: ctx.request.input('declared') ?? {},
        pin: this.pin(ctx),
      })
    )
  }

  async cashClose(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.cierreGlobal(ctx.business, a, {
        force: ctx.request.input('force') === true,
        pin: this.pin(ctx),
      })
    )
  }

  async cashHistory(ctx: HttpContext) {
    return this.manejar(ctx, async (a) => {
      await PermissionService.exigir(ctx.business, a, 'caja.corte_global')
      return CashService.historial(ctx.business)
    })
  }

  async cashReprint(ctx: HttpContext) {
    return this.manejar(ctx, (a) =>
      CashService.reimprimirGlobal(ctx.business, a, Number(ctx.params.id))
    )
  }

  // ----------------------------------------------------- central de impresión

  /** Trabajos por imprimir (las últimas 12 h, hasta 5 intentos). */
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

  /** Prueba de impresora, o una cuenta de muestra para ver el estilo del ticket. */
  async testPrint(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const muestra = ctx.request.input('kind') === 'muestra'
    const job = await SalonService.encolar(null, ctx.business, {
      kind: muestra ? 'precuenta' : 'prueba',
      printerId: Number(ctx.request.input('printerId')) || null,
      orderId: null,
      payload: muestra
        ? {
            negocio: ctx.business.name,
            simbolo: ctx.business.currencySymbol || 'S/',
            servicio: 'comedor',
            mesa: 'Mesa 5',
            mesero: 'Ana',
            comensales: 2,
            folio: 'A-000123',
            documento: 'A-000123',
            lineas: [
              { cantidad: 2, nombre: 'Lomo saltado', total: 56 },
              { cantidad: 1, nombre: 'Chicha morada jarra', total: 12 },
            ],
            subtotal: 68,
            descuento: 0,
            total: 68,
            pagos: [],
          }
        : { negocio: ctx.business.name },
    })
    return { status: 'success', data: job }
  }

  // ---------------------------------------------------------- infraestructura

  async config(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const b = ctx.business.id
    await FolioService.seriePorDefecto(ctx.business)
    const [
      printers,
      areas,
      tables,
      staff,
      categories,
      products,
      registers,
      series,
      devices,
      ajustes,
    ] = await Promise.all([
      Printer.query().where('business_id', b).orderBy('id', 'asc'),
      ProductionArea.query()
        .where('business_id', b)
        .orderBy('sort_order', 'asc')
        .orderBy('id', 'asc'),
      DiningTable.query().where('business_id', b).orderBy('sort_order', 'asc').orderBy('id', 'asc'),
      StaffService.listar(ctx.business),
      Category.query()
        .where('business_id', b)
        .orderBy('sort_order', 'asc')
        .select('id', 'name', 'production_area_id'),
      Product.query()
        .where('business_id', b)
        .andWhere('status', 'activo')
        .preload('categoryLinks')
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .select('id', 'name', 'production_area_id'),
      CashService.cajas(ctx.business).then(() =>
        db
          .from('cash_registers')
          .where('business_id', b)
          .andWhere('is_active', true)
          .orderBy('id', 'asc')
      ),
      db.from('folio_series').where('business_id', b).orderBy('id', 'asc'),
      StaffService.equipos(ctx.business),
      PosSettingsService.leer(ctx.business),
    ])
    return {
      status: 'success',
      data: {
        printers,
        areas,
        tables,
        staff,
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          productionAreaId: c.productionAreaId,
        })),
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          productionAreaId: p.productionAreaId,
          categoryIds: p.categoryLinks.map((l) => l.categoryId),
        })),
        registers: registers.map((r) => ({
          id: r.id,
          name: r.name,
          folioSeriesId: r.folio_series_id,
        })),
        series: series.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          nextNumber: s.next_number,
          isActive: s.is_active,
        })),
        devices,
        pairingCode: await StaffService.codigoVinculacion(ctx.business),
        ajustes,
        catalogoPermisos: PERMISOS,
        roles: ROLES_POS,
      },
    }
  }

  async saveSettings(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, () =>
      PosSettingsService.guardar(
        ctx.business,
        ctx.request.only([
          'permisos',
          'inactividadSegundos',
          'liberarMesaManual',
          'servicios',
          'ticket',
        ])
      )
    )
  }

  async rotatePairing(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return {
      status: 'success',
      data: { pairingCode: await StaffService.codigoVinculacion(ctx.business, true) },
    }
  }

  async saveDevice(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, () =>
      StaffService.editarEquipo(
        ctx.business,
        Number(ctx.params.id),
        ctx.request.only(['name', 'cashRegisterId', 'mode', 'areaIds'])
      )
    )
  }

  async deleteDevice(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    await StaffService.revocarEquipo(ctx.business, Number(ctx.params.id))
    return { status: 'success' }
  }

  async saveRegister(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const r = id
        ? await CashRegister.query()
            .where('business_id', ctx.business.id)
            .andWhere('id', id)
            .firstOrFail()
        : new CashRegister()
      const name = String(ctx.request.input('name', r.name ?? ''))
        .trim()
        .slice(0, 60)
      if (!name) throw new OrderError('Escribe el nombre de la caja')
      r.merge({ businessId: ctx.business.id, name, isActive: true })
      await r.save()
      if (ctx.request.input('folioSeriesId') !== undefined) {
        const s = Number(ctx.request.input('folioSeriesId')) || null
        if (s) {
          const existe = await db
            .from('folio_series')
            .where('business_id', ctx.business.id)
            .andWhere('id', s)
            .first()
          if (!existe) throw new OrderError('Serie no válida')
        }
        await db.from('cash_registers').where('id', r.id).update({ folio_series_id: s })
      }
      return r
    })
  }

  async deleteRegister(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const abierta = await db
        .from('cash_sessions')
        .where('cash_register_id', Number(ctx.params.id))
        .andWhere('status', 'abierta')
        .first()
      if (abierta) throw new OrderError('Esa caja está abierta: haz su corte Z primero')
      await CashRegister.query()
        .where('business_id', ctx.business.id)
        .andWhere('id', Number(ctx.params.id))
        .update({ is_active: false })
      return { ok: true }
    })
  }

  async saveSeries(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const name =
        ctx.request.input('name') === undefined
          ? undefined
          : String(ctx.request.input('name') ?? '')
              .trim()
              .slice(0, 60) || null
      if (!id) {
        const code = String(ctx.request.input('code', '')).trim().toUpperCase().slice(0, 16)
        if (!/^[A-Z0-9-]{1,16}$/.test(code))
          throw new OrderError('Código de serie: letras y números, sin espacios')
        const existe = await db
          .from('folio_series')
          .where('business_id', ctx.business.id)
          .andWhere('code', code)
          .first()
        if (existe) throw new OrderError('Ya existe esa serie')
        const inicio = Math.max(1, Math.floor(Number(ctx.request.input('nextNumber', 1)) || 1))
        await db.table('folio_series').insert({
          business_id: ctx.business.id,
          code,
          name: name ?? null,
          next_number: inicio,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        return { ok: true }
      }
      const actual = await db
        .from('folio_series')
        .where('id', id)
        .andWhere('business_id', ctx.business.id)
        .first()
      if (!actual) throw new OrderError('Serie no encontrada')
      const cambios: Record<string, unknown> = { updated_at: new Date() }
      if (name !== undefined) cambios.name = name
      if (ctx.request.input('isActive') !== undefined)
        cambios.is_active = Boolean(ctx.request.input('isActive'))
      // El siguiente número solo puede subir: bajarlo repetiría folios ya usados.
      if (ctx.request.input('nextNumber') !== undefined) {
        const nuevo = Math.floor(Number(ctx.request.input('nextNumber')))
        if (!(nuevo >= actual.next_number)) {
          throw new OrderError(`El siguiente folio no puede ser menor a ${actual.next_number}`)
        }
        // Se sube dentro del mismo UPDATE con GREATEST para no pisar un folio que se tomó justo ahora.
        await db.rawQuery(
          'UPDATE folio_series SET next_number = GREATEST(next_number, ?) WHERE id = ?',
          [nuevo, id]
        )
      }
      await db.from('folio_series').where('id', id).update(cambios)
      return { ok: true }
    })
  }

  /** Áreas para los formularios de plato y categoría. */
  async areas(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const areas = await ProductionArea.query()
      .where('business_id', ctx.business.id)
      .andWhere('is_active', true)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
    return { status: 'success', data: areas.map((a) => ({ id: a.id, name: a.name })) }
  }

  async savePrinter(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const p = id
        ? await Printer.query()
            .where('business_id', ctx.business.id)
            .andWhere('id', id)
            .firstOrFail()
        : new Printer()
      const name = String(ctx.request.input('name', p.name ?? ''))
        .trim()
        .slice(0, 60)
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
    await Printer.query()
      .where('business_id', ctx.business.id)
      .andWhere('id', Number(ctx.params.id))
      .delete()
    return { status: 'success' }
  }

  async saveArea(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const a = id
        ? await ProductionArea.query()
            .where('business_id', ctx.business.id)
            .andWhere('id', id)
            .firstOrFail()
        : new ProductionArea()
      const name = String(ctx.request.input('name', a.name ?? ''))
        .trim()
        .slice(0, 60)
      if (!name) throw new OrderError('Escribe un nombre')
      const printerId = ctx.request.input('printerId', a.printerId ?? null)
      if (printerId) {
        await Printer.query()
          .where('business_id', ctx.business.id)
          .andWhere('id', Number(printerId))
          .firstOrFail()
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
      const filasAreas = await ProductionArea.query().where('business_id', b).select('id')
      const validas = new Set(filasAreas.map((a) => a.id))
      const limpiar = (v: unknown) => {
        const n = Number(v)
        if (!v || !n) return null
        if (!validas.has(n)) throw new OrderError('Área no válida')
        return n
      }
      const cats = (ctx.request.input('categories') ?? {}) as Record<string, unknown>
      for (const [id, area] of Object.entries(cats)) {
        await Category.query()
          .where('business_id', b)
          .andWhere('id', Number(id))
          .update({ production_area_id: limpiar(area) })
      }
      const prods = (ctx.request.input('products') ?? {}) as Record<string, unknown>
      for (const [id, area] of Object.entries(prods)) {
        await Product.query()
          .where('business_id', b)
          .andWhere('id', Number(id))
          .update({ production_area_id: limpiar(area) })
      }
      return { ok: true }
    })
  }

  async saveTable(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const id = Number(ctx.params.id) || null
      const t = id
        ? await DiningTable.query()
            .where('business_id', ctx.business.id)
            .andWhere('id', id)
            .firstOrFail()
        : new DiningTable()
      const name = String(ctx.request.input('name', t.name ?? ''))
        .trim()
        .slice(0, 40)
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

  /** Crea varias mesas de una: "1" … "N" (o "Terraza 1"…). */
  async bulkTables(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    return this.manejar(ctx, async () => {
      const cantidad = Math.floor(Number(ctx.request.input('count')))
      if (!cantidad || cantidad < 1 || cantidad > 100) throw new OrderError('Entre 1 y 100 mesas')
      const prefijo = String(ctx.request.input('prefix', '') ?? '')
        .trim()
        .slice(0, 20)
      const zone =
        String(ctx.request.input('zone', '') ?? '')
          .trim()
          .slice(0, 40) || null
      const existentes = await DiningTable.query()
        .where('business_id', ctx.business.id)
        .count('* as n')
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
      const abierta = await Order.query()
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
      return id
        ? StaffService.actualizar(ctx.business, id, datos)
        : StaffService.crear(ctx.business, datos as any)
    })
  }

  async deleteStaff(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    await StaffService.eliminar(ctx.business, Number(ctx.params.id))
    return { status: 'success' }
  }

  /** Quién autorizó qué (descuentos, cancelaciones, anulaciones…). */
  async authorizationLog(ctx: HttpContext) {
    if (!this.soloDueno(ctx)) return
    const filas = await db
      .from('authorization_logs')
      .where('business_id', ctx.business.id)
      .orderBy('id', 'desc')
      .limit(100)
    return { status: 'success', data: filas }
  }
}

/** Equipos del local y entrada del personal con PIN — públicas, sin token. */
export class PosDeviceController {
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

  /** Vincula este equipo al negocio con el código que ve el dueño. */
  async pair(ctx: HttpContext) {
    return this.manejar(ctx, () =>
      StaffService.vincular(ctx.request.input('code'), ctx.request.input('name'))
    )
  }

  async info(ctx: HttpContext) {
    return this.manejar(ctx, async () => {
      const info = await StaffService.infoEquipo(ctx.request.input('deviceToken'))
      if (!info) throw new OrderError('Este equipo no está vinculado')
      return info
    })
  }

  /** Equipo en modo monitor: muestra los platos de sus áreas sin pedir PIN. */
  private async equipoMonitor(ctx: HttpContext) {
    const d = await StaffService.equipo(ctx.request.input('deviceToken'))
    if (!d) throw new OrderError('Este equipo no está vinculado')
    if (d.mode !== 'monitor') throw new OrderError('Este equipo no es un monitor de producción')
    const business = await Business.findOrFail(d.business_id)
    if (business.status !== 'activo') throw new OrderError('Negocio inactivo')
    await db.from('pos_devices').where('id', d.id).update({ last_seen_at: new Date() })
    return { d, business }
  }

  async monitor(ctx: HttpContext) {
    return this.manejar(ctx, async () => {
      const { d, business } = await this.equipoMonitor(ctx)
      const areaIds = StaffService.areasDeEquipo(d)
      const areas = areaIds.length
        ? await db.from('production_areas').whereIn('id', areaIds).select('id', 'name')
        : []
      return {
        equipo: d.name,
        negocio: business.name,
        areas: areas.map((a) => a.name),
        tickets: await KitchenService.tickets(business, areaIds.length ? areaIds : null),
      }
    })
  }

  async monitorItems(ctx: HttpContext) {
    return this.manejar(ctx, async () => {
      const { business } = await this.equipoMonitor(ctx)
      return KitchenService.cambiar(
        business,
        ctx.request.input('ids') ?? [],
        ctx.request.input('estado')
      )
    })
  }

  async login(ctx: HttpContext) {
    return this.manejar(ctx, async () => {
      const { token, staff, negocio } = await StaffService.entrar(
        ctx.request.input('deviceToken'),
        ctx.request.input('pin')
      )
      return { token: token.toJSON(), name: staff.name, role: staff.role, negocio }
    })
  }
}
