import Supplier from '#models/supplier'
import type { HttpContext } from '@adonisjs/core/http'

export default class SuppliersController {
  public async index({ business, request }: HttpContext) {
    const search = request.input('search')

    const query = Supplier.query().where('business_id', business.id).orderBy('name', 'asc')

    if (search) {
      query.where((sub) => {
        sub.whereILike('name', `%${search}%`).orWhereILike('ruc', `%${search}%`)
      })
    }

    return { status: 'success', data: await query }
  }

  public async store({ request, business }: HttpContext) {
    const data = request.only([
      'name',
      'ruc',
      'contact_name',
      'phone',
      'email',
      'address',
      'notes',
    ])

    const supplier = await Supplier.create({
      businessId: business.id,
      name: data.name,
      ruc: data.ruc ?? null,
      contactName: data.contact_name ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      notes: data.notes ?? null,
      status: 'activo',
    })

    return { status: 'success', message: 'Proveedor creado', data: supplier }
  }

  public async update({ params, request, business }: HttpContext) {
    const supplier = await Supplier.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    const data = request.only([
      'name',
      'ruc',
      'contact_name',
      'phone',
      'email',
      'address',
      'notes',
      'status',
    ])

    supplier.merge({
      name: data.name ?? supplier.name,
      ruc: data.ruc ?? supplier.ruc,
      contactName: data.contact_name ?? supplier.contactName,
      phone: data.phone ?? supplier.phone,
      email: data.email ?? supplier.email,
      address: data.address ?? supplier.address,
      notes: data.notes ?? supplier.notes,
      status: data.status ?? supplier.status,
    })

    await supplier.save()

    return { status: 'success', message: 'Proveedor actualizado', data: supplier }
  }

  public async destroy({ params, business }: HttpContext) {
    const supplier = await Supplier.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .preload('purchaseOrders', (q) => q.limit(1))
      .firstOrFail()

    // Con compras registradas no se borra: el historial dejaría de cuadrar.
    if (supplier.purchaseOrders.length) {
      supplier.status = 'inactivo'
      await supplier.save()
      return {
        status: 'success',
        message: 'El proveedor tiene compras registradas: se marcó como inactivo',
      }
    }

    await supplier.delete()

    return { status: 'success', message: 'Proveedor eliminado' }
  }
}
