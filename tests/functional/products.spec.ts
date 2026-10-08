import Business from '#models/business'
import Category from '#models/category'
import Role from '#models/role'
import Subcategory from '#models/subcategory'
import Tag from '#models/tag'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/**
 * Formulario de producto: categorías múltiples, etiquetas, SKU que sigue a la
 * variación simple y listado paginado.
 */

async function crearTienda(nombre: string) {
  const rolAdmin = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  const user = await User.create({
    name: `${nombre} ${randomUUID()}`,
    email: `${randomUUID()}@test.pe`,
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
  const motor = await Category.create({ businessId: business.id, name: 'Motor', slug: 'motor' })
  const lubricacion = await Subcategory.create({
    businessId: business.id,
    categoryId: motor.id,
    name: 'Lubricación',
    slug: 'lubricacion',
  })
  const sail = await Category.create({ businessId: business.id, name: 'Sail', slug: 'sail' })
  const tag = await Tag.create({ businessId: business.id, name: 'NDC', slug: 'ndc', color: '#7C3AED' })
  return { user, business, motor, lubricacion, sail, tag }
}

test.group('Productos: formulario', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crea un producto con varias categorías, etiquetas y stock inicial', async ({
    client,
    assert,
  }) => {
    const t = await crearTienda('Repuestos Uno')

    const res = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({
        name: 'Bomba de aceite',
        price: 150,
        sku: 'BAC-1',
        stock: 7,
        category_links: [
          { categoryId: t.motor.id, subcategoryId: t.lubricacion.id },
          { categoryId: t.sail.id },
        ],
        tag_ids: [t.tag.id],
      })
      .loginAs(t.user)

    res.assertStatus(200)
    const id = res.body().data.id

    const detalle = await client.get(`/api/b/${t.business.uuid}/products/${id}`).loginAs(t.user)
    const p = detalle.body().data
    assert.lengthOf(p.categoryLinks, 2)
    assert.lengthOf(p.tags, 1)
    assert.equal(p.variations[0].stock, 7)
    assert.equal(p.variations[0].sku, 'BAC-1')
  })

  test('rechaza una categoría de otra tienda', async ({ client }) => {
    const rosa = await crearTienda('Tienda Rosa')
    const luis = await crearTienda('Tienda Luis')

    const res = await client
      .post(`/api/b/${rosa.business.uuid}/products`)
      .json({ name: 'X', price: 1, category_links: [{ categoryId: luis.motor.id }] })
      .loginAs(rosa.user)

    res.assertStatus(422)
  })

  test('rechaza una subcategoría que no es de la categoría indicada', async ({ client }) => {
    const t = await crearTienda('Tienda Dos')

    const res = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({
        name: 'X',
        price: 1,
        category_links: [{ categoryId: t.sail.id, subcategoryId: t.lubricacion.id }],
      })
      .loginAs(t.user)

    res.assertStatus(422)
  })

  test('al editar, las categorías se reemplazan y el SKU sigue a la variación simple', async ({
    client,
    assert,
  }) => {
    const t = await crearTienda('Tienda Tres')
    const creado = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({ name: 'Filtro', price: 10, sku: 'F-1', category_links: [{ categoryId: t.motor.id }] })
      .loginAs(t.user)
    const id = creado.body().data.id

    const res = await client
      .put(`/api/b/${t.business.uuid}/products/${id}`)
      .json({ sku: 'F-2', price: 12, category_links: [{ categoryId: t.sail.id }], tag_ids: [] })
      .loginAs(t.user)
    res.assertStatus(200)

    const p = (await client.get(`/api/b/${t.business.uuid}/products/${id}`).loginAs(t.user)).body()
      .data
    assert.lengthOf(p.categoryLinks, 1)
    assert.equal(p.categoryLinks[0].categoryId, t.sail.id)
    assert.equal(p.variations[0].sku, 'F-2')
    assert.equal(Number(p.variations[0].price), 12)
  })

  test('el listado se pagina cuando se pide page', async ({ client, assert }) => {
    const t = await crearTienda('Tienda Cuatro')
    for (let i = 0; i < 3; i++) {
      await client
        .post(`/api/b/${t.business.uuid}/products`)
        .json({ name: `Producto ${i}`, price: 1 })
        .loginAs(t.user)
    }

    const res = await client
      .get(`/api/b/${t.business.uuid}/products?page=1&perPage=2`)
      .loginAs(t.user)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 2)
    assert.equal(res.body().meta.total, 3)
  })
})
