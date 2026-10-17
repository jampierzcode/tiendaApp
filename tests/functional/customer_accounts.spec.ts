import Business from '#models/business'
import BusinessImage from '#models/business_image'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/** Cuentas de cliente: una cuenta, pedidos de varias tiendas, sin robar pedidos ajenos. */

async function tienda(nombre: string, conFoto = false) {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  const user = await User.create({
    name: nombre,
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
  const img = conFoto
    ? await BusinessImage.create({ businessId: business.id, url: '/media/polo.png', type: 'producto', status: 'activo' } as any)
    : null
  const p = await Product.create({
    businessId: business.id,
    name: 'Polo',
    slug: `polo-${randomUUID().slice(0, 4)}`,
    price: 50,
    taxRate: 18,
    lowStockThreshold: 1,
    stock: 0,
    status: 'activo',
    businessImageId: img?.id ?? null,
  } as any)
  const v = await ProductVariation.create({ businessId: business.id, productId: p.id, isDefault: true, price: 50, stock: 10 })
  return { user, business, v, base: `/api/b/${business.uuid}` }
}

test.group('Cuentas de cliente', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const pedir = async (client: any, t: Awaited<ReturnType<typeof tienda>>, phone = '51933735080') => {
    const r = await client.post(`/api/store/${t.business.slug}/orders`).json({
      customerName: 'Ana',
      customerPhone: phone,
      deliveryMethod: 'recojo',
      items: [{ variationId: t.v.id, quantity: 1 }],
    })
    r.assertStatus(201)
    return r.body().data as { code: string; claimToken: string }
  }

  test('crear cuenta con el código del pedido y ver pedidos de dos tiendas', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const b = await tienda('Modas B')
    const pa = await pedir(client, a)

    const reg = await client.post(`/api/store/${a.business.slug}/account/register`).json({
      name: 'Ana Torres',
      email: 'ana@correo.pe',
      password: 'clave-propia-1',
      orderCode: pa.code,
      claimToken: pa.claimToken,
    })
    reg.assertStatus(201)
    assert.isTrue(reg.body().data.ligado)
    const token = reg.body().data.token

    // Ya con sesión, un pedido en otra tienda queda ligado solo.
    const rb = await client
      .post(`/api/store/${b.business.slug}/orders`)
      .header('Authorization', `Bearer ${token}`)
      .json({ customerName: 'Ana', customerPhone: '51933735080', deliveryMethod: 'recojo', items: [{ variationId: b.v.id, quantity: 1 }] })
    rb.assertStatus(201)

    const lista = await client.get('/api/account/orders').header('Authorization', `Bearer ${token}`)
    lista.assertStatus(200)
    const slugs = lista.body().data.map((o: any) => o.storeSlug).sort()
    assert.deepEqual(slugs, [a.business.slug, b.business.slug].sort())
  })

  test('un token ajeno o inventado no liga el pedido', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const pa = await pedir(client, a)

    const reg = await client.post(`/api/store/${a.business.slug}/account/register`).json({
      name: 'Intruso',
      email: 'intruso@correo.pe',
      password: 'clave-propia-1',
      orderCode: pa.code,
      claimToken: 'inventado',
    })
    reg.assertStatus(201)
    assert.isFalse(reg.body().data.ligado)
    const lista = await client.get('/api/account/orders').header('Authorization', `Bearer ${reg.body().data.token}`)
    assert.lengthOf(lista.body().data, 0)
  })

  test('correo repetido, contraseña corta y login de dueños', async ({ client }) => {
    const a = await tienda('Modas A')
    const url = `/api/store/${a.business.slug}/account/register`
    ;(await client.post(url).json({ name: 'Ana', email: a.user.email, password: 'clave-propia-1' })).assertStatus(409)
    ;(await client.post(url).json({ name: 'Ana', email: 'x@y.pe', password: '123' })).assertStatus(422)
    ;(await client.post('/api/account/login').json({ email: a.user.email, password: 'secreto123' })).assertStatus(403)
    ;(await client.post('/api/account/login').json({ email: a.user.email, password: 'mala' })).assertStatus(401)
  })

  test('el código de país no duplica al cliente de la tienda', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    await pedir(client, a, '51933735080')
    await pedir(client, a, '933735080')
    const res = await client.get(`${a.base}/customers`).loginAs(a.user)
    res.assertStatus(200)
    const lista = res.body().data?.data ?? res.body().data
    assert.lengthOf(lista, 1)
  })

  test('el pedido en el panel trae la foto del producto', async ({ client, assert }) => {
    const a = await tienda('Con foto', true)
    const sin = await tienda('Sin foto')
    await pedir(client, a)
    await pedir(client, sin)

    const r1 = await client.get(`${a.base}/orders`).loginAs(a.user)
    assert.match(r1.body().data[0].items[0].imageUrl, /\/media\/polo\.png$/)
    const r2 = await client.get(`${sin.base}/orders`).loginAs(sin.user)
    assert.isNull(r2.body().data[0].items[0].imageUrl)
  })

  test('el cliente guarda su WhatsApp y su ubicación, y los recupera', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const reg = await client.post(`/api/store/${a.business.slug}/account/register`).json({
      name: 'Ana',
      email: 'perfil@correo.pe',
      password: 'clave-propia-1',
    })
    const token = reg.body().data.token

    const res = await client.put('/api/account/profile').header('Authorization', `Bearer ${token}`).json({
      phone: '+51 933 735 080',
      deliveryAddress: 'Av. Brasil 123',
      deliveryCity: 'Lima',
      latitude: -12.0464,
      longitude: -77.0428,
    })
    res.assertStatus(200)

    const me = (await client.get('/api/account/me').header('Authorization', `Bearer ${token}`)).body().data
    assert.equal(me.phone, '51933735080')
    assert.equal(me.deliveryAddress, 'Av. Brasil 123')
    assert.equal(me.latitude, -12.0464)

    ;(await client.put('/api/account/profile').header('Authorization', `Bearer ${token}`).json({ latitude: 200, longitude: 0 })).assertStatus(422)
    const sin = await client.put('/api/account/profile').header('Authorization', `Bearer ${token}`).json({ latitude: null, longitude: null })
    assert.isNull(sin.body().data.latitude)

    // Un dueño no usa este perfil.
    ;(await client.put('/api/account/profile').loginAs(a.user).json({ phone: '1' })).assertStatus(403)
  })
})
