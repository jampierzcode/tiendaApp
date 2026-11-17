import Business from '#models/business'
import Plan from '#models/plan'
import PlanPrice from '#models/plan_price'
import Role from '#models/role'
import Subscription from '#models/subscription'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

/** Planes: funciones por plan, precio × cantidad, renovación, cambio de plan y anulación. */

async function usuario(rolNombre: 'admin' | 'superadmin') {
  const rol = await Role.firstOrCreate({ name: rolNombre }, { name: rolNombre })
  return User.create({
    name: rolNombre,
    email: `${randomUUID()}@test.pe`,
    password: 'secreto123',
    rolId: rol.id,
    status: 'activo',
  })
}

async function tienda() {
  const user = await usuario('admin')
  const business = await Business.create({
    uuid: randomUUID(),
    name: 'Mers Test',
    slug: `m-${randomUUID().slice(0, 8)}`,
    userId: user.id,
    status: 'activo',
    isPublic: true,
    businessType: 'retail',
    whatsappPhone: '51987654321',
    subscriptionStatus: 'active',
  } as any)
  return { user, business, base: `/api/b/${business.uuid}` }
}

async function restaurante() {
  const user = await usuario('admin')
  const business = await Business.create({
    uuid: randomUUID(),
    name: 'Pollería Test',
    slug: `p-${randomUUID().slice(0, 8)}`,
    userId: user.id,
    status: 'activo',
    isPublic: true,
    businessType: 'restaurant',
    whatsappPhone: '51987654321',
    subscriptionStatus: 'active',
  } as any)
  return { user, business, base: `/api/b/${business.uuid}` }
}

async function precio(key: string, interval: 'month' | 'year') {
  const plan = await Plan.findByOrFail('key', key)
  return PlanPrice.query().where('plan_id', plan.id).where('interval', interval).firstOrFail()
}

test.group('Planes y suscripciones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un negocio sin plan (anterior a los planes) conserva todo', async ({ client }) => {
    const t = await restaurante()
    const r = await client.get(`${t.base}/orders`).loginAs(t.user)
    r.assertStatus(200)
    const tienda = await client.get(`/api/store/${t.business.slug}`)
    tienda.assertBodyContains({ data: { pedidosEnLinea: true } })
  })

  test('plan Carta: carta sí, pedidos no; la tienda pide por WhatsApp', async ({
    client,
    assert,
  }) => {
    const t = await restaurante()
    const admin = await usuario('superadmin')
    const carta = await precio('restaurante_carta', 'month')

    const alta = await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: carta.id, quantity: 3, paymentMethod: 'yape' })
      .loginAs(admin)
    alta.assertStatus(201)
    assert.equal(alta.body().data.total, 45)

    const pedidos = await client.get(`${t.base}/orders`).loginAs(t.user)
    pedidos.assertStatus(403)
    pedidos.assertBodyContains({ code: 'plan_required', feature: 'pedidos_online' })
    ;(await client.get(`${t.base}/products`).loginAs(t.user)).assertStatus(200)
    ;(await client.get(`${t.base}/discounts`).loginAs(t.user)).assertStatus(200)
    ;(await client.get(`${t.base}/whatsapp`).loginAs(t.user)).assertStatus(403)
    ;(await client.get(`${t.base}/ingredients`).loginAs(t.user)).assertStatus(403)

    const tienda = await client.get(`/api/store/${t.business.slug}`)
    tienda.assertBodyContains({ data: { pedidosEnLinea: false, cuentasCliente: false } })
    const pedido = await client.post(`/api/store/${t.business.slug}/orders`).json({ items: [] })
    pedido.assertStatus(422)
    pedido.assertBodyContains({ code: 'solo_whatsapp' })

    const miPlan = await client.get(`${t.base}/plan`).loginAs(t.user)
    miPlan.assertStatus(200)
    assert.equal(miPlan.body().data.plan.key, 'restaurante_carta')
    assert.sameMembers(miPlan.body().data.funciones, ['carta', 'qr', 'promociones'])
  })

  test('renovar el mismo plan suma al final; cambiar de plan empieza hoy', async ({
    client,
    assert,
  }) => {
    const t = await restaurante()
    const admin = await usuario('superadmin')
    const mensual = await precio('restaurante_pedidos', 'month')
    const anual = await precio('restaurante_ia', 'year')

    await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: mensual.id, quantity: 2 })
      .loginAs(admin)
    const renovacion = await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: mensual.id, quantity: 1 })
      .loginAs(admin)
    renovacion.assertStatus(201)

    const [primera, segunda] = await Subscription.query()
      .where('business_id', t.business.id)
      .orderBy('id', 'asc')
    assert.equal(segunda.startsAt.toISO(), primera.endsAt.toISO())
    await t.business.refresh()
    assert.equal(t.business.paidUntil!.toISODate(), DateTime.now().plus({ months: 3 }).toISODate())
    ;(await client.get(`${t.base}/orders`).loginAs(t.user)).assertStatus(200)
    ;(await client.get(`${t.base}/whatsapp`).loginAs(t.user)).assertStatus(403)

    // Sube a Pedidos + IA anual: lo anterior se cierra hoy y la renovación programada se anula.
    const cambio = await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: anual.id, quantity: 1, paymentMethod: 'transferencia' })
      .loginAs(admin)
    cambio.assertStatus(201)
    assert.equal(cambio.body().data.total, 799)

    await primera.refresh()
    await segunda.refresh()
    assert.isTrue(primera.endsAt <= DateTime.now())
    assert.equal(segunda.status, 'cancelled')

    await t.business.refresh()
    assert.equal(t.business.paidUntil!.toISODate(), DateTime.now().plus({ years: 1 }).toISODate())
    ;(await client.get(`${t.base}/whatsapp`).loginAs(t.user)).assertStatus(200)

    const historial = await client
      .get(`/api/businesses/${t.business.id}/subscriptions`)
      .loginAs(admin)
    assert.lengthOf(historial.body().data.subscriptions, 3)
  })

  test('anular el único pago deja el negocio vencido, no con acceso libre', async ({
    client,
    assert,
  }) => {
    const t = await restaurante()
    const admin = await usuario('superadmin')
    const carta = await precio('restaurante_carta', 'month')
    const alta = await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: carta.id, quantity: 1 })
      .loginAs(admin)

    const anular = await client
      .post(`/api/subscriptions/${alta.body().data.id}/cancel`)
      .json({ reason: 'error de carga' })
      .loginAs(admin)
    anular.assertStatus(200)
    await t.business.refresh()
    assert.equal(t.business.subscriptionStatus, 'expired')
    ;(await client.post(`${t.base}/categories`).json({ name: 'X' }).loginAs(t.user)).assertStatus(
      402
    )
  })

  test('cantidad fuera de rango y planes solo para superadmin', async ({ client }) => {
    const t = await restaurante()
    const admin = await usuario('superadmin')
    const anual = await precio('restaurante_carta', 'year')
    const r = await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: anual.id, quantity: 6 })
      .loginAs(admin)
    r.assertStatus(422)
    ;(await client.get('/api/subscribe/plans').qs({ business_type: 'restaurant' })).assertStatus(
      200
    )
    ;(await client.get('/api/subscriptions').loginAs(t.user)).assertStatus(403)
  })

  test('el alta de un restaurante arranca con prueba del plan más completo', async ({
    client,
    assert,
  }) => {
    const r = await client.post('/api/subscribe').json({
      owner: { name: 'Dueño Test', email: `${randomUUID()}@test.pe`, password: 'secreto123' },
      business: {
        name: 'Pollería Nueva',
        business_type: 'restaurant',
        template: 'cafeteria', // sin fotos: no toca el bucket
        whatsapp_phone: '51987654321',
        country: 'PE',
      },
    })
    r.assertStatus(201)
    const business = await Business.query()
      .where('name', 'Pollería Nueva')
      .preload('currentPlan')
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.equal(business.currentPlan.key, 'restaurante_ia')
    assert.equal(business.subscriptionStatus, 'trial')
    const prueba = await Subscription.findByOrFail('business_id', business.id)
    assert.equal(prueba.interval, 'trial')
  })

  test('tienda en plan Catálogo: inventario sí; pedidos, envíos y compras no', async ({
    client,
  }) => {
    const t = await tienda()
    const admin = await usuario('superadmin')
    const catalogo = await precio('tienda_catalogo', 'month')
    ;(
      await client
        .post(`/api/businesses/${t.business.id}/subscriptions`)
        .json({ planPriceId: catalogo.id, quantity: 1 })
        .loginAs(admin)
    ).assertStatus(201)
    ;(await client.get(`${t.base}/inventory/low-stock`).loginAs(t.user)).assertStatus(200)
    ;(await client.get(`${t.base}/products`).loginAs(t.user)).assertStatus(200)
    const envios = await client.get(`${t.base}/shipments`).loginAs(t.user)
    envios.assertStatus(403)
    envios.assertBodyContains({ feature: 'envios' })
    ;(await client.get(`${t.base}/purchases`).loginAs(t.user)).assertStatus(403)
    ;(await client.get(`${t.base}/orders`).loginAs(t.user)).assertStatus(403)
    const tiendaPublica = await client.get(`/api/store/${t.business.slug}`)
    tiendaPublica.assertBodyContains({ data: { pedidosEnLinea: false } })
  })

  test('precio especial: Tienda + IA a S/ 60 el mes', async ({ client, assert }) => {
    const t = await tienda()
    const admin = await usuario('superadmin')
    const ia = await precio('tienda_ia', 'month')
    const r = await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: ia.id, quantity: 2, unitPrice: 60, paymentMethod: 'yape' })
      .loginAs(admin)
    r.assertStatus(201)
    assert.equal(r.body().data.unitPrice, 60)
    assert.equal(r.body().data.total, 120)
    ;(await client.get(`${t.base}/purchases`).loginAs(t.user)).assertStatus(200)
    ;(await client.get(`${t.base}/whatsapp`).loginAs(t.user)).assertStatus(200)
  })

  test('restaurante con plan Pedidos conserva los envíos', async ({ client }) => {
    const t = await restaurante()
    const admin = await usuario('superadmin')
    const pedidos = await precio('restaurante_pedidos', 'month')
    await client
      .post(`/api/businesses/${t.business.id}/subscriptions`)
      .json({ planPriceId: pedidos.id, quantity: 1 })
      .loginAs(admin)
    ;(await client.get(`${t.base}/shipments`).loginAs(t.user)).assertStatus(200)
  })
})
