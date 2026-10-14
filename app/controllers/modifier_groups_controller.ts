import Ingredient from '#models/ingredient'
import ModifierGroup from '#models/modifier_group'
import ModifierOption from '#models/modifier_option'
import Product from '#models/product'
import ProductModifierGroup from '#models/product_modifier_group'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

interface OpcionEntrada {
  id?: number
  name: string
  priceDelta?: number
  isActive?: boolean
  ingredientId?: number | null
  ingredientQty?: number
}

/**
 * Grupos de modificadores del restaurante y su asignación a los platos.
 */
export default class ModifierGroupsController {
  public async index({ business }: HttpContext) {
    const groups = await ModifierGroup.query()
      .where('business_id', business.id)
      .preload('options', (o) => o.orderBy('sort_order', 'asc').orderBy('id', 'asc'))
      .orderBy('name', 'asc')

    const usos = await db
      .from('product_modifier_groups')
      .where('business_id', business.id)
      .groupBy('modifier_group_id')
      .select('modifier_group_id')
      .count('* as total')
    const usoPorGrupo = new Map(usos.map((u: any) => [u.modifier_group_id, Number(u.total)]))

    return {
      status: 'success',
      data: groups.map((g) => ({ ...g.serialize(), productsCount: usoPorGrupo.get(g.id) ?? 0 })),
    }
  }

  public async store({ business, request, response }: HttpContext) {
    const { name, description, options } = request.only(['name', 'description', 'options'])

    if (!String(name ?? '').trim()) {
      return response.unprocessableEntity({ status: 'error', message: 'El grupo necesita un nombre' })
    }

    const group = await db.transaction(async (trx) => {
      const g = await ModifierGroup.create(
        { businessId: business.id, name: String(name).trim(), description: description || null },
        { client: trx }
      )
      await this.sincronizarOpciones(g, business.id, options ?? [], trx)
      return g
    })

    await group.load('options')
    return response.created({ status: 'success', data: group })
  }

  public async update({ business, params, request, response }: HttpContext) {
    const group = await ModifierGroup.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    const { name, description, isActive, options } = request.only([
      'name',
      'description',
      'isActive',
      'options',
    ])

    if (name !== undefined && !String(name).trim()) {
      return response.unprocessableEntity({ status: 'error', message: 'El grupo necesita un nombre' })
    }

    await db.transaction(async (trx) => {
      group.merge({
        name: name !== undefined ? String(name).trim() : group.name,
        description: description === undefined ? group.description : description || null,
        isActive: isActive === undefined ? group.isActive : Boolean(isActive),
      })
      group.useTransaction(trx)
      await group.save()

      if (Array.isArray(options)) {
        await this.sincronizarOpciones(group, business.id, options, trx)
      }
    })

    await group.load('options', (o) => o.orderBy('sort_order', 'asc'))
    return { status: 'success', data: group }
  }

  public async destroy({ business, params }: HttpContext) {
    const group = await ModifierGroup.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    // Las líneas de pedidos viejos conservan su copia del nombre y precio.
    await group.delete()
    return { status: 'success', message: 'Grupo eliminado' }
  }

  /** Grupos asignados a un plato, con sus reglas. */
  public async forProduct({ business, params }: HttpContext) {
    const filas = await ProductModifierGroup.query()
      .where('business_id', business.id)
      .andWhere('product_id', params.productId)
      .orderBy('sort_order', 'asc')

    return {
      status: 'success',
      data: filas.map((f) => ({
        modifierGroupId: f.modifierGroupId,
        minSelect: f.minSelect,
        maxSelect: f.maxSelect,
        sortOrder: f.sortOrder,
      })),
    }
  }

  /** Reemplaza los grupos del plato por la lista recibida. */
  public async syncForProduct({ business, params, request, response }: HttpContext) {
    const product = await Product.query()
      .where('business_id', business.id)
      .andWhere('id', params.productId)
      .first()

    if (!product) {
      return response.notFound({ status: 'error', message: 'Producto no encontrado' })
    }

    const entrada: any[] = Array.isArray(request.input('groups')) ? request.input('groups') : []
    const ids = entrada.map((g) => Number(g.modifierGroupId))

    const propios = await ModifierGroup.query()
      .where('business_id', business.id)
      .whereIn('id', ids.length ? ids : [0])
    if (propios.length !== new Set(ids).size) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'Alguno de los grupos no pertenece a este negocio',
      })
    }

    await db.transaction(async (trx) => {
      await ProductModifierGroup.query({ client: trx })
        .where('business_id', business.id)
        .andWhere('product_id', product.id)
        .delete()

      for (const [i, g] of entrada.entries()) {
        const max = Math.max(1, Math.floor(Number(g.maxSelect ?? 1)))
        const min = Math.min(max, Math.max(0, Math.floor(Number(g.minSelect ?? 0))))
        await ProductModifierGroup.create(
          {
            businessId: business.id,
            productId: product.id,
            modifierGroupId: Number(g.modifierGroupId),
            minSelect: min,
            maxSelect: max,
            sortOrder: i,
          },
          { client: trx }
        )
      }
    })

    return { status: 'success', message: 'Modificadores del plato actualizados' }
  }

  private async sincronizarOpciones(
    group: ModifierGroup,
    businessId: number,
    opciones: OpcionEntrada[],
    trx: any
  ) {
    const existentes = await ModifierOption.query({ client: trx }).where(
      'modifier_group_id',
      group.id
    )
    const mantenidas = new Set<number>()

    // Solo se aceptan insumos de este mismo negocio.
    const pedidos = [...new Set(opciones.map((o) => Number(o.ingredientId)).filter(Boolean))]
    const propiosRows = pedidos.length
      ? await Ingredient.query({ client: trx })
          .where('business_id', businessId)
          .whereIn('id', pedidos)
          .select('id')
      : []
    const propios = new Set(propiosRows.map((r) => r.id))

    for (const [i, entrada] of opciones.entries()) {
      const nombre = String(entrada.name ?? '').trim()
      if (!nombre) continue

      const datos = {
        name: nombre,
        priceDelta: Number(entrada.priceDelta ?? 0) || 0,
        isActive: entrada.isActive === undefined ? true : Boolean(entrada.isActive),
        sortOrder: i,
        ingredientId: propios.has(Number(entrada.ingredientId)) ? Number(entrada.ingredientId) : null,
        ingredientQty:
          propios.has(Number(entrada.ingredientId)) ? Math.max(0, Number(entrada.ingredientQty ?? 0) || 0) : 0,
      }

      const actual = entrada.id ? existentes.find((e) => e.id === Number(entrada.id)) : null

      if (actual) {
        actual.merge(datos)
        actual.useTransaction(trx)
        await actual.save()
        mantenidas.add(actual.id)
      } else {
        const nueva = await ModifierOption.create(
          { ...datos, businessId, modifierGroupId: group.id },
          { client: trx }
        )
        mantenidas.add(nueva.id)
      }
    }

    for (const e of existentes) {
      if (!mantenidas.has(e.id)) {
        e.useTransaction(trx)
        await e.delete()
      }
    }
  }
}
