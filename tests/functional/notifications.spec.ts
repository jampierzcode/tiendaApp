import Business from '#models/business'
import Notification from '#models/notification'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/** Avisos del panel: un pedido de la tienda crea una notificación «pedido». */

async function montar() {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  const crear = async (nombre: string) => {
    const user = await User.create({
      name: `${nombre} ${randomUUID()}`,
      email: `${randomUUID()}@test.pe`,
      password: 'secreto123',
      rolId: rol.id,
      status: 'activo',
    })
    const business = await Business.create({
      uuid: randomUUID(),
      name: nombre,
      slug: `t-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      status: 'activo',
      isPublic: true,
      whatsappPhone: '51987654321',
    } as any)
    const p = await Product.create({
      businessId: business.id,
      name: 'Polo',
      slug: `polo-${randomUUID().slice(0, 4)}`,
      price: 50,
      taxRate: 18,
      lowStockThreshold: 1,
      stock: 0,
      status: 'activo',
    })
    const v = await ProductVariation.create({
      businessId: business.id,
      productId: p.id,
      isDefault: true,
      price: 50,
      stock: 10,
    })
    return { user, business, v, base: `/api/b/${business.uuid}` }
  }
  return { a: await crear('Modas A'), b: await crear('Modas B') }
}

test.group('Notificaciones del panel', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const pedir = (client: any, t: Awaited<ReturnType<typeof montar>>['a']) =>
    client.post(`/api/store/${t.business.slug}/orders`).json({
      customerName: 'Ana',
      customerPhone: '987654321',
      deliveryMethod: 'recojo',
      items: [{ variationId: t.v.id, quantity: 1 }],
    })

  test('un pedido de la tienda crea una notificación que apunta al pedido', async ({ client, assert }) => {
    const { a } = await montar()
    ;(await pedir(client, a)).assertStatus(201)

    const res = await client.get(`${a.base}/notifications`).loginAs(a.user)
    res.assertStatus(200)
    const { items, unread } = res.body().data
    assert.equal(unread, 1)
    assert.equal(items[0].type, 'pedido')
    assert.isNumber(items[0].orderId)
    assert.include(items[0].title, 'Pedido nuevo')
    assert.isNull(items[0].readAt)
  })

  test('marcar como leída y marcar todas', async ({ client, assert }) => {
    const { a } = await montar()
    await pedir(client, a)
    await pedir(client, a)

    const lista = (await client.get(`${a.base}/notifications`).loginAs(a.user)).body().data
    assert.equal(lista.unread, 2)

    ;(await client.put(`${a.base}/notifications/${lista.items[0].id}/read`).loginAs(a.user)).assertStatus(200)
    const tras = (await client.get(`${a.base}/notifications`).loginAs(a.user)).body().data
    assert.equal(tras.unread, 1)

    ;(await client.put(`${a.base}/notifications/read-all`).loginAs(a.user)).assertStatus(200)
    const fin = (await client.get(`${a.base}/notifications`).loginAs(a.user)).body().data
    assert.equal(fin.unread, 0)
    assert.lengthOf(fin.items, 2)
  })

  test('cada negocio ve solo sus avisos', async ({ client, assert }) => {
    const { a, b } = await montar()
    await pedir(client, a)

    const deB = (await client.get(`${b.base}/notifications`).loginAs(b.user)).body().data
    assert.equal(deB.unread, 0)

    const ajena = await Notification.query().where('business_id', a.business.id).firstOrFail()
    ;(await client.put(`${b.base}/notifications/${ajena.id}/read`).loginAs(b.user)).assertStatus(404)
  })
})
