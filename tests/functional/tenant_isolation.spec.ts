import Business from '#models/business'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/**
 * El aislamiento entre tiendas es la invariante que no puede volver a
 * romperse: antes cualquier admin autenticado podía leer y escribir el
 * catálogo de cualquier otra tienda mandando el id.
 */

async function crearTienda(nombre: string, email: string) {
  const rolAdmin = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })

  const user = await User.create({
    name: `${nombre} ${email}`,
    email,
    password: 'secreto123',
    rolId: rolAdmin.id,
    status: 'activo',
  })

  const business = await Business.create({
    uuid: randomUUID(),
    name: nombre,
    userId: user.id,
    status: 'activo',
  })

  const product = await Product.create({
    businessId: business.id,
    name: `Polo de ${nombre}`,
    slug: `polo-${business.id}`,
    price: 39.9,
    taxRate: 18,
    lowStockThreshold: 5,
    stock: 0,
    status: 'activo',
  })

  const variation = await ProductVariation.create({
    businessId: business.id,
    productId: product.id,
    isDefault: true,
    price: 39.9,
    stock: 10,
    priceModifier: 0,
  })

  return { user, business, product, variation }
}

test.group('Aislamiento entre tiendas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un admin ve solo los productos de su tienda', async ({ client, assert }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)
    await crearTienda('Boutique Andes', `luis-${randomUUID()}@test.pe`)

    const respuesta = await client
      .get(`/api/b/${rosa.business.uuid}/products`)
      .loginAs(rosa.user)

    respuesta.assertStatus(200)
    const productos = respuesta.body().data
    assert.lengthOf(productos, 1)
    assert.equal(productos[0].businessId, rosa.business.id)
  })

  test('un admin no puede leer el catálogo de otra tienda', async ({ client }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)
    const luis = await crearTienda('Boutique Andes', `luis-${randomUUID()}@test.pe`)

    const respuesta = await client
      .get(`/api/b/${luis.business.uuid}/products`)
      .loginAs(rosa.user)

    respuesta.assertStatus(403)
  })

  test('un admin no puede crear productos en otra tienda', async ({ client }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)
    const luis = await crearTienda('Boutique Andes', `luis-${randomUUID()}@test.pe`)

    const respuesta = await client
      .post(`/api/b/${luis.business.uuid}/products`)
      .json({ name: 'Intruso', price: 1 })
      .loginAs(rosa.user)

    respuesta.assertStatus(403)
  })

  test('un admin no puede tocar por id una variación de otra tienda', async ({ client }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)
    const luis = await crearTienda('Boutique Andes', `luis-${randomUUID()}@test.pe`)

    // Usa su propia tienda en la URL, pero el id de una variación ajena.
    const respuesta = await client
      .put(`/api/b/${rosa.business.uuid}/product-variations/${luis.variation.id}`)
      .json({ price: 1 })
      .loginAs(rosa.user)

    respuesta.assertStatus(404)
  })

  test('el superadmin sí entra a cualquier tienda', async ({ client }) => {
    const rolSuper = await Role.firstOrCreate({ name: 'superadmin' }, { name: 'superadmin' })
    const superadmin = await User.create({
      name: 'Super',
      email: `super-${randomUUID()}@test.pe`,
      password: 'secreto123',
      rolId: rolSuper.id,
      status: 'activo',
    })

    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)

    const respuesta = await client
      .get(`/api/b/${rosa.business.uuid}/products`)
      .loginAs(superadmin)

    respuesta.assertStatus(200)
  })

  test('un admin no puede listar usuarios ni negocios', async ({ client }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)

    const usuarios = await client.get('/api/users').loginAs(rosa.user)
    usuarios.assertStatus(403)

    const negocios = await client.get('/api/businesses').loginAs(rosa.user)
    negocios.assertStatus(403)
  })
})

test.group('Seguridad de la cuenta', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el registro público ignora el rol que le manden', async ({ client, assert }) => {
    const rolSuper = await Role.firstOrCreate({ name: 'superadmin' }, { name: 'superadmin' })
    const rolAdmin = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })

    const respuesta = await client.post('/api/register').json({
      name: 'Atacante',
      email: `atacante-${randomUUID()}@test.pe`,
      password: '12345678',
      rol_id: rolSuper.id,
    })

    respuesta.assertStatus(201)
    assert.equal(respuesta.body().data.user.rolId, rolAdmin.id)
  })

  test('nadie puede cambiar la contraseña de otro usuario', async ({ client }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)

    const respuesta = await client
      .post('/api/updatePassword')
      .json({ email: 'superadmin@app.com', newPassword: 'tomado123' })
      .loginAs(rosa.user)

    // Sin currentPassword el validador la rechaza: el email del body ya no
    // sirve para nada.
    respuesta.assertStatus(422)
  })

  test('cambiar la propia contraseña exige la actual', async ({ client }) => {
    const rosa = await crearTienda('Modas Lima', `rosa-${randomUUID()}@test.pe`)

    const mal = await client
      .post('/api/updatePassword')
      .json({
        currentPassword: 'equivocada',
        newPassword: 'nueva12345',
        newPasswordConfirmation: 'nueva12345',
      })
      .loginAs(rosa.user)
    mal.assertStatus(401)

    const bien = await client
      .post('/api/updatePassword')
      .json({
        currentPassword: 'secreto123',
        newPassword: 'nueva12345',
        newPasswordConfirmation: 'nueva12345',
      })
      .loginAs(rosa.user)
    bien.assertStatus(200)
  })
})
