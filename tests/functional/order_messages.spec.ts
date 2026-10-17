import Business from '#models/business'
import BusinessImage from '#models/business_image'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/** Mensajes dentro de la plataforma, correo del cliente y revisión del WhatsApp. */

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

test.group('Mensajes del pedido y contacto', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const pedir = (client: any, t: Awaited<ReturnType<typeof tienda>>, extra: object = {}) =>
    client.post(`/api/store/${t.business.slug}/orders`).json({
      customerName: 'Ana',
      customerPhone: '51933735080',
      deliveryMethod: 'recojo',
      items: [{ variationId: t.v.id, quantity: 1 }],
      ...extra,
    })

  test('rechaza un WhatsApp incompleto y acepta los válidos', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const corto = await pedir(client, a, { customerPhone: '5193373580' }) // un dígito menos
    corto.assertStatus(422)
    assert.include(corto.body().message, 'incompleto')
    ;(await pedir(client, a, { customerPhone: '93373580' })).assertStatus(422)
    ;(await pedir(client, a, { customerPhone: '933735080' })).assertStatus(201)
    ;(await pedir(client, a, { customerPhone: '+51 933 735 080' })).assertStatus(201)
    ;(await pedir(client, a, { customerPhone: '573001234567' })).assertStatus(201) // Colombia
  })

  test('guarda el correo y lo muestra en el pedido; rechaza uno inválido', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    ;(await pedir(client, a, { customerEmail: 'sin-arroba' })).assertStatus(422)
    ;(await pedir(client, a, { customerEmail: 'Ana@Correo.pe' })).assertStatus(201)
    const lista = await client.get(`${a.base}/orders`).loginAs(a.user)
    assert.equal(lista.body().data[0].customerEmail, 'ana@correo.pe')
  })

  test('el negocio y el cliente se escriben con el código del pedido', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const creado = (await pedir(client, a)).body().data
    const orden = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data[0]
    const claim = { 'x-claim-token': creado.claimToken }

    ;(await client.post(`${a.base}/orders/${orden.id}/messages`).loginAs(a.user).json({ body: 'Hola, ¿confirmas tu dirección?' })).assertStatus(201)
    const verCliente = await client.get(`/api/store/${a.business.slug}/orders/${creado.code}/messages`).headers(claim)
    verCliente.assertStatus(200)
    assert.equal(verCliente.body().data[0].body, 'Hola, ¿confirmas tu dirección?')

    ;(await client.post(`/api/store/${a.business.slug}/orders/${creado.code}/messages`).headers(claim).json({ body: 'Sí, es Av. Brasil 123' })).assertStatus(201)

    // El negocio ve 1 sin leer en la lista y un aviso de «mensaje».
    const antes = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data[0]
    assert.equal(antes.platformUnread, 1)
    const avisos = (await client.get(`${a.base}/notifications`).loginAs(a.user)).body().data.items
    assert.isTrue(avisos.some((n: any) => n.type === 'mensaje' && n.orderId === orden.id))

    // Al abrir el hilo se marca como leído.
    const hilo = await client.get(`${a.base}/orders/${orden.id}/messages`).loginAs(a.user)
    assert.lengthOf(hilo.body().data, 2)
    assert.isFalse(hilo.body().meta.hasAccount)
    const despues = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data[0]
    assert.equal(despues.platformUnread, 0)
  })

  test('sin el código correcto no se leen ni se escriben mensajes', async ({ client }) => {
    const a = await tienda('Modas A')
    const b = await tienda('Modas B')
    const creado = (await pedir(client, a)).body().data
    const url = `/api/store/${a.business.slug}/orders/${creado.code}/messages`
    ;(await client.get(url)).assertStatus(404)
    ;(await client.get(url).header('x-claim-token', 'otro')).assertStatus(404)
    ;(await client.post(url).header('x-claim-token', 'otro').json({ body: 'hola' })).assertStatus(404)

    const orden = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data[0]
    ;(await client.get(`${b.base}/orders/${orden.id}/messages`).loginAs(b.user)).assertStatus(404)
  })

  test('el cliente con cuenta chatea desde Mi cuenta y el negocio sabe que tiene cuenta', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const creado = (await pedir(client, a)).body().data
    const reg = await client.post(`/api/store/${a.business.slug}/account/register`).json({
      name: 'Ana',
      email: 'cuenta@correo.pe',
      password: 'clave-propia-1',
      orderCode: creado.code,
      claimToken: creado.claimToken,
    })
    const auth = { Authorization: `Bearer ${reg.body().data.token}` }
    const orden = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data[0]

    await client.post(`${a.base}/orders/${orden.id}/messages`).loginAs(a.user).json({ body: 'Tu pedido sale hoy' })
    const lista = (await client.get('/api/account/orders').headers(auth)).body().data
    assert.equal(lista[0].unreadMessages, 1)

    const base = `/api/account/orders/${a.business.slug}/${creado.code}/messages`
    const leido = await client.get(base).headers(auth)
    assert.equal(leido.body().data[0].body, 'Tu pedido sale hoy')
    ;(await client.post(base).headers(auth).json({ body: 'Gracias' })).assertStatus(201)
    assert.equal((await client.get('/api/account/orders').headers(auth)).body().data[0].unreadMessages, 0)

    const hilo = await client.get(`${a.base}/orders/${orden.id}/messages`).loginAs(a.user)
    assert.isTrue(hilo.body().meta.hasAccount)
  })

  test('corregir el número de un cliente también corrige sus pedidos', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    await pedir(client, a, { customerPhone: '933735080' })
    await pedir(client, a, { customerName: 'Otro', customerPhone: '922365704' })
    const clientes = (await client.get(`${a.base}/customers`).loginAs(a.user)).body().data
    const ana = clientes.find((c: any) => c.name === 'Ana')
    const otro = clientes.find((c: any) => c.name === 'Otro')

    // Incompleto o repetido: se rechaza.
    ;(await client.put(`${a.base}/customers/${ana.id}`).loginAs(a.user).json({ phone: '51933735' })).assertStatus(422)
    ;(await client.put(`${a.base}/customers/${ana.id}`).loginAs(a.user).json({ phone: otro.phone })).assertStatus(422)

    const ok = await client.put(`${a.base}/customers/${ana.id}`).loginAs(a.user).json({ phone: '+51 933 735 099', email: 'Ana@Correo.pe' })
    ok.assertStatus(200)
    assert.equal(ok.body().data.phone, '51933735099')

    const pedidos = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data
    const deAna = pedidos.find((p: any) => p.customerName === 'Ana')
    assert.equal(deAna.customerPhone, '51933735099')
    assert.equal(deAna.customerEmail, 'ana@correo.pe')
    assert.equal(pedidos.find((p: any) => p.customerName === 'Otro').customerPhone, '51922365704')
  })

  test('un pedido hecho antes de tener cuenta se liga con código y teléfono', async ({ client, assert }) => {
    const a = await tienda('Modas A')
    const antes = (await pedir(client, a, { customerPhone: '51933735080' })).body().data
    const reg = await client.post(`/api/store/${a.business.slug}/account/register`).json({
      name: 'Ana',
      email: 'tarde@correo.pe',
      password: 'clave-propia-1',
    })
    const auth = { Authorization: `Bearer ${reg.body().data.token}` }
    assert.lengthOf((await client.get('/api/account/orders').headers(auth)).body().data, 0)

    // Teléfono equivocado: no liga.
    ;(await client.post('/api/account/link').headers(auth).json({ slug: a.business.slug, orderCode: antes.code, phone: '999999999' })).assertStatus(422)
    ;(await client.post('/api/account/link').headers(auth).json({ slug: a.business.slug, orderCode: antes.code, phone: '933 735 080' })).assertStatus(200)

    const lista = (await client.get('/api/account/orders').headers(auth)).body().data
    assert.lengthOf(lista, 1)

    // Los mensajes del negocio salen con el último en la lista.
    const orden = (await client.get(`${a.base}/orders`).loginAs(a.user)).body().data[0]
    await client.post(`${a.base}/orders/${orden.id}/messages`).loginAs(a.user).json({ body: 'Tu pedido va en camino' })
    const conMsg = (await client.get('/api/account/orders').headers(auth)).body().data[0]
    assert.equal(conMsg.lastMessage, 'Tu pedido va en camino')
    assert.equal(conMsg.lastDirection, 'out')
  })
})
