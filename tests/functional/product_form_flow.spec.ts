import Business from '#models/business'
import Product from '#models/product'
import ProductAttribute from '#models/product_attribute'
import ProductAttributeValue from '#models/product_attribute_value'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import StockMovement from '#models/stock_movement'
import User from '#models/user'
import InventoryService from '#services/inventory_service'
import SkuService from '#services/sku_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/**
 * Formulario de producto con atributos, SKU automático, mínimo por variación
 * y movimientos manuales de inventario.
 */

async function crearTienda() {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  const user = await User.create({
    name: `Dueña ${randomUUID()}`,
    email: `${randomUUID()}@test.pe`,
    password: 'secreto123',
    rolId: rol.id,
    status: 'activo',
  })
  const business = await Business.create({ uuid: randomUUID(), name: 'Modas', userId: user.id, status: 'activo' })
  const talla = await ProductAttribute.create({ businessId: business.id, name: 'Talla', type: 'text' })
  const color = await ProductAttribute.create({ businessId: business.id, name: 'Color', type: 'text' })
  const v = (a: ProductAttribute, value: string) =>
    ProductAttributeValue.create({ businessId: business.id, attributeId: a.id, value })
  return {
    user,
    business,
    S: await v(talla, 'S'),
    M: await v(talla, 'M'),
    negro: await v(color, 'Negro'),
  }
}

test.group('SKU automático', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un producto sin SKU recibe uno único; dos con el mismo nombre no chocan', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`

    const a = await client.post(`${base}/products`).json({ name: 'Polo Básico', price: 30 }).loginAs(t.user)
    const b = await client.post(`${base}/products`).json({ name: 'Polo Básico', price: 35 }).loginAs(t.user)
    a.assertStatus(200)
    b.assertStatus(200)

    assert.equal(a.body().data.sku, 'POL-001')
    assert.equal(b.body().data.sku, 'POL-002')
    // La variación única lleva el mismo SKU que el producto.
    assert.equal(a.body().data.variations[0].sku, 'POL-001')
  })

  test('respeta el SKU que el usuario escribió y avisa si está repetido', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`

    ;(await client.post(`${base}/products`).json({ name: 'Zapatilla', price: 90, sku: 'MI-ZAP' }).loginAs(t.user)).assertStatus(200)
    const repetido = await client.post(`${base}/products`).json({ name: 'Otra', price: 90, sku: 'MI-ZAP' }).loginAs(t.user)

    repetido.assertStatus(422)
    assert.match(repetido.body().message, /SKU/)
  })

  test('el SKU de cada variación se arma con el del producto y sus valores', async ({ client, assert }) => {
    const t = await crearTienda()
    const res = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({
        name: 'Casaca',
        price: 100,
        variations: [
          { attributeValueIds: [t.S.id, t.negro.id], stock: 3 },
          { attributeValueIds: [t.M.id, t.negro.id], stock: 4 },
        ],
      })
      .loginAs(t.user)

    res.assertStatus(200)
    const skus = res.body().data.variations.map((v: any) => v.sku).sort()
    assert.deepEqual(skus, ['CAS-001-M-NEG', 'CAS-001-S-NEG'])
  })

  test('la sugerencia por API devuelve el siguiente libre sin reservarlo', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`

    const antes = await client.get(`${base}/products-sku/suggest?name=Polo`).loginAs(t.user)
    const otra = await client.get(`${base}/products-sku/suggest?name=Polo`).loginAs(t.user)
    assert.equal(antes.body().data.sku, 'POL-001')
    assert.equal(otra.body().data.sku, 'POL-001')

    assert.equal(await SkuService.sugerirProducto(t.business.id, 'Árbol'), 'ARB-001')
  })
})

test.group('Producto con atributos desde el formulario', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('nace con sus variaciones, stock inicial por cada una y sin variación oculta', async ({ client, assert }) => {
    const t = await crearTienda()
    const res = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({
        name: 'Casaca Denim',
        price: 120,
        low_stock_threshold: 4,
        variations: [
          { attributeValueIds: [t.S.id], stock: 10 },
          { attributeValueIds: [t.M.id], stock: 5, lowStockThreshold: 2 },
        ],
      })
      .loginAs(t.user)

    res.assertStatus(200)
    const id = res.body().data.id
    const vars = await ProductVariation.query().where('product_id', id)

    assert.lengthOf(vars, 2)
    assert.isTrue(vars.every((v) => !v.isDefault))
    assert.equal((await Product.findOrFail(id)).stock, 15)
    assert.isTrue(vars.every((v) => Number(v.price) === 120))
    assert.deepEqual(
      vars.map((v) => v.lowStockThreshold).sort(),
      [2, null]
    )

    const movs = await StockMovement.query().where('business_id', t.business.id).where('type', 'inicial')
    assert.lengthOf(movs, 2)
  })

  test('si una variación es inválida no queda el producto', async ({ client, assert }) => {
    const t = await crearTienda()
    const res = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({
        name: 'Fantasma',
        price: 10,
        variations: [{ attributeValueIds: [t.S.id] }, { attributeValueIds: [999999] }],
      })
      .loginAs(t.user)

    res.assertStatus(422)
    assert.lengthOf(await Product.query().where('business_id', t.business.id).where('name', 'Fantasma'), 0)
  })

  test('agregar varias variaciones a un producto existente es todo o nada', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`
    const creado = await client.post(`${base}/products`).json({ name: 'Polo', price: 30, stock: 6 }).loginAs(t.user)
    const id = creado.body().data.id

    const mal = await client
      .post(`${base}/products/${id}/variations`)
      .json({ variations: [{ attributeValueIds: [t.S.id] }, { attributeValueIds: [t.S.id] }] })
      .loginAs(t.user)
    mal.assertStatus(422)
    // Nada se creó ni se movió el stock del producto simple.
    assert.lengthOf(await ProductVariation.query().where('product_id', id).whereNot('is_default', true), 0)
    assert.equal((await Product.findOrFail(id)).stock, 6)

    const bien = await client
      .post(`${base}/products/${id}/variations`)
      .json({ variations: [{ attributeValueIds: [t.S.id] }, { attributeValueIds: [t.M.id] }] })
      .loginAs(t.user)
    bien.assertStatus(201)
    assert.equal((await Product.findOrFail(id)).stock, 6) // el stock simple pasó a la primera talla
  })

  test('editar una variación ya no cambia su stock', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`
    const creado = await client
      .post(`${base}/products`)
      .json({ name: 'Polo', price: 30, variations: [{ attributeValueIds: [t.S.id], stock: 8 }] })
      .loginAs(t.user)
    const v = creado.body().data.variations[0]

    const res = await client
      .put(`${base}/product-variations/${v.id}`)
      .json({ price: 35, stock: 999, low_stock_threshold: 1 })
      .loginAs(t.user)

    res.assertStatus(200)
    const despues = await ProductVariation.findOrFail(v.id)
    assert.equal(despues.stock, 8)
    assert.equal(Number(despues.price), 35)
    assert.equal(despues.lowStockThreshold, 1)
  })

  test('el mínimo propio de la variación manda sobre el del producto en las alertas', async ({ client, assert }) => {
    const t = await crearTienda()
    const res = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({
        name: 'Casaca',
        price: 100,
        low_stock_threshold: 2,
        variations: [
          { attributeValueIds: [t.S.id], stock: 5 }, // 5 > 2 → sin alerta
          { attributeValueIds: [t.M.id], stock: 5, lowStockThreshold: 6 }, // 5 ≤ 6 → alerta
        ],
      })
      .loginAs(t.user)
    res.assertStatus(200)

    const alertas = await InventoryService.lowStock(t.business.id)
    assert.lengthOf(alertas, 1)
    assert.equal(alertas[0].lowStockThreshold, 6)
  })
})

test.group('Movimientos manuales de inventario', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function conVariacion(stock: number) {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`
    return { t, base, variationId: 0, stock }
  }

  async function producto(client: any, t: any, stock: number) {
    const r = await client
      .post(`/api/b/${t.business.uuid}/products`)
      .json({ name: 'Polo', price: 30, stock })
      .loginAs(t.user)
    return r.body().data.variations[0].id as number
  }

  test('entrada, salida y ajuste dejan su movimiento con motivo', async ({ client, assert }) => {
    const { t, base } = await conVariacion(0)
    const id = await producto(client, t, 50)

    ;(await client.post(`${base}/inventory/manual`).json({ variationId: id, kind: 'entrada', quantity: 10, reason: 'Encontré cajas' }).loginAs(t.user)).assertStatus(200)
    assert.equal((await ProductVariation.findOrFail(id)).stock, 60)

    ;(await client.post(`${base}/inventory/manual`).json({ variationId: id, kind: 'salida', quantity: 5, reason: 'Merma por humedad' }).loginAs(t.user)).assertStatus(200)
    assert.equal((await ProductVariation.findOrFail(id)).stock, 55)

    // Tenías 55, cuentas 20: quedan 20.
    ;(await client.post(`${base}/inventory/manual`).json({ variationId: id, kind: 'ajuste', quantity: 20, reason: 'Conteo físico' }).loginAs(t.user)).assertStatus(200)
    assert.equal((await ProductVariation.findOrFail(id)).stock, 20)

    const movs = await StockMovement.query().where('product_variation_id', id).orderBy('id', 'asc')
    assert.deepEqual(
      movs.map((m) => [m.type, m.quantity]),
      [
        ['inicial', 50],
        ['entrada_manual', 10],
        ['salida_manual', -5],
        ['ajuste', -35],
      ]
    )
    assert.equal(movs[1].note, 'Encontré cajas')
    assert.equal((await Product.findOrFail((await ProductVariation.findOrFail(id)).productId)).stock, 20)
  })

  test('exige motivo, cantidades válidas y no deja la salida bajo cero', async ({ client, assert }) => {
    const { t, base } = await conVariacion(0)
    const id = await producto(client, t, 3)
    const manual = (data: any) => client.post(`${base}/inventory/manual`).json({ variationId: id, ...data }).loginAs(t.user)

    ;(await manual({ kind: 'entrada', quantity: 1, reason: '' })).assertStatus(422)
    ;(await manual({ kind: 'entrada', quantity: 0, reason: 'Prueba' })).assertStatus(422)
    ;(await manual({ kind: 'entrada', quantity: 1.5, reason: 'Prueba' })).assertStatus(422)
    ;(await manual({ kind: 'salida', quantity: 10, reason: 'Demasiado' })).assertStatus(422)
    ;(await manual({ kind: 'otra', quantity: 1, reason: 'Prueba' })).assertStatus(422)
    ;(await manual({ kind: 'ajuste', quantity: -1, reason: 'Negativo' })).assertStatus(422)

    assert.equal((await ProductVariation.findOrFail(id)).stock, 3)
  })

  test('otra tienda no puede mover el stock de mi variación', async ({ client, assert }) => {
    const { t, base } = await conVariacion(0)
    const id = await producto(client, t, 5)
    const intruso = await crearTienda()

    const res = await client
      .post(`/api/b/${intruso.business.uuid}/inventory/manual`)
      .json({ variationId: id, kind: 'salida', quantity: 1, reason: 'Robo' })
      .loginAs(intruso.user)

    assert.notEqual(res.status(), 200)
    assert.equal((await ProductVariation.findOrFail(id)).stock, 5)
    void base
  })
})
