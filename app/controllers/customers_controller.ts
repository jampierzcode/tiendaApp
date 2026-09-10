import Customer from '#models/customer'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Clientes de la tienda. Se crean solos con el primer pedido, así que aquí
 * solo se consultan y se anotan: nadie los da de alta a mano.
 */
export default class CustomersController {
  public async index({ business, request }: HttpContext) {
    const search = request.input('search')
    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 25))

    const query = Customer.query().where('business_id', business.id)

    if (search) {
      query.where((sub) => {
        sub.whereILike('name', `%${search}%`).orWhereILike('phone', `%${search}%`)
      })
    }

    const clientes = await query.orderBy('id', 'desc').paginate(page, perPage)

    // Cuántos pedidos y cuánto ha gastado cada uno. Se resuelve en una sola
    // consulta agrupada en vez de un preload por cliente.
    const ids = clientes.all().map((c) => c.id)

    const totales = ids.length
      ? await db
          .from('orders')
          .whereIn('customer_id', ids)
          .whereNotIn('status', ['cancelado', 'devuelto'])
          .groupBy('customer_id')
          .select('customer_id')
          .count('* as pedidos')
          .sum('total as gastado')
      : []

    const porCliente = new Map(
      totales.map((t: any) => [
        Number(t.customer_id),
        { pedidos: Number(t.pedidos), gastado: Number(t.gastado) },
      ])
    )

    return {
      status: 'success',
      meta: clientes.getMeta(),
      data: clientes.all().map((c) => ({
        ...c.serialize(),
        pedidos: porCliente.get(c.id)?.pedidos ?? 0,
        gastado: porCliente.get(c.id)?.gastado ?? 0,
      })),
    }
  }

  public async show({ params, business }: HttpContext) {
    const cliente = await Customer.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .preload('orders', (o) => o.preload('items').orderBy('id', 'desc'))
      .firstOrFail()

    return { status: 'success', data: cliente }
  }

  public async update({ params, request, business }: HttpContext) {
    const cliente = await Customer.query()
      .where('business_id', business.id)
      .andWhere('id', params.id)
      .firstOrFail()

    cliente.merge(request.only(['name', 'email', 'document', 'address', 'city', 'notes']))
    await cliente.save()

    return { status: 'success', message: 'Cliente actualizado', data: cliente }
  }
}
