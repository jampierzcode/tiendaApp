import Business from '#models/business'
import Product from '#models/product'
import ProductAttribute from '#models/product_attribute'
import ProductAttributeValue from '#models/product_attribute_value'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import StockMovement from '#models/stock_movement'
import Supplier from '#models/supplier'
import User from '#models/user'
import InventoryService from '#services/inventory_service'
import PurchaseService, { PurchaseError } from '#services/purchase_service'
import VariationService, { VariationError } from '#services/variation_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/**
 * Productos, variaciones, compras e inventario trabajando juntos: producto
 * simple que pasa a tener tallas, alta de producto desde Compras y costo por
 * variante sin tocar el precio de venta.
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
  const business = await Business.create({
    uuid: randomUUID(),
    name: 'Modas Lima',
    userId: user.id,
    status: 'activo',
  })
  const talla = await ProductAttribute.create({ businessId: business.id, name: 'Talla', type: 'text' })
  const color = await ProductAttribute.create({ businessId: business.id, name: 'Color', type: 'text' })
  const valor = (attr: ProductAttribute, v: string) =>
    ProductAttributeValue.create({ businessId: business.id, attributeId: attr.id, value: v })
  const S = await valor(talla, 'S')
  const M = await valor(talla, 'M')
  const azul = await valor(color, 'Azul')
  const supplier = await Supplier.create({ businessId: business.id, name: 'Gamarra SAC', status: 'activo' })
  return { user, business, S, M, azul, supplier }
}

/** Producto simple: una variación oculta con su stock. */
async function productoSimple(t: Awaited<ReturnType<typeof crearTienda>>, stock: number) {
  const product = await Product.create({
    businessId: t.business.id,
    name: 'Polo Básico',
    slug: `polo-${randomUUID()}`,
    price: 39.9,
    cost: 20,
    taxRate: 18,
    lowStockThreshold: 3,
    stock: 0,
    status: 'activo',
  })
  const oculta = await ProductVariation.create({
    businessId: t.business.id,
    productId: product.id,
    isDefault: true,
    price: 39.9,
    stock: 0,
  })
  if (stock) {
    await InventoryService.applyMovement({
      businessId: t.business.id,
      variationId: oculta.id,
      type: 'inicial',
      quantity: stock,
    })
  }
  return { product, oculta }
}

const stockProducto = async (id: number) => {
  const p = await Product.findOrFail(id)
  return Number(p.stock)
}

test.group('Producto simple → con tallas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('la primera variación recibe el stock del producto simple, sin duplicarlo', async ({ assert }) => {
    const t = await crearTienda()
    const { product, oculta } = await productoSimple(t, 10)

    const s = await VariationService.crear(
      t.business,
      product,
      { attributeValueIds: [t.S.id] },
      t.user.id
    )

    await oculta.refresh()
    assert.equal(oculta.stock, 0)
    assert.equal(s.stock, 10)
    assert.equal(await stockProducto(product.id), 10)

    // Kardex: salida de la oculta + entrada en la nueva, mismo motivo.
    const movs = await StockMovement.query()
      .where('business_id', t.business.id)
      .where('reference_type', 'variation_migration')
      .orderBy('id', 'asc')
    assert.lengthOf(movs, 2)
    assert.equal(movs[0].quantity, -10)
    assert.equal(movs[1].quantity, 10)
  })

  test('la segunda variación no vuelve a mover nada', async ({ assert }) => {
    const t = await crearTienda()
    const { product } = await productoSimple(t, 10)

    await VariationService.crear(t.business, product, { attributeValueIds: [t.S.id] }, t.user.id)
    const m = await VariationService.crear(t.business, product, { attributeValueIds: [t.M.id] }, t.user.id)

    assert.equal(m.stock, 0)
    assert.equal(await stockProducto(product.id), 10)
    const migraciones = await StockMovement.query()
      .where('business_id', t.business.id)
      .where('reference_type', 'variation_migration')
    assert.lengthOf(migraciones, 2)
  })

  test('producto sin stock: pasa a tallas sin crear movimientos', async ({ assert }) => {
    const t = await crearTienda()
    const { product } = await productoSimple(t, 0)

    await VariationService.crear(t.business, product, { attributeValueIds: [t.S.id] }, t.user.id)

    const migraciones = await StockMovement.query()
      .where('business_id', t.business.id)
      .where('reference_type', 'variation_migration')
    assert.lengthOf(migraciones, 0)
    assert.equal(await stockProducto(product.id), 0)
  })

  test('usa el precio base si no se manda precio y guarda el costo aparte', async ({ assert }) => {
    const t = await crearTienda()
    const { product } = await productoSimple(t, 0)

    const v = await VariationService.crear(
      t.business,
      product,
      { attributeValueIds: [t.S.id], cost: 18.5 },
      t.user.id
    )

    assert.equal(Number(v.price), 39.9)
    assert.equal(Number(v.cost), 18.5)
  })

  test('rechaza la misma combinación dos veces y atributos de otra tienda', async ({ assert }) => {
    const t = await crearTienda()
    const otra = await crearTienda()
    const { product } = await productoSimple(t, 0)

    await VariationService.crear(t.business, product, { attributeValueIds: [t.S.id, t.azul.id] }, t.user.id)

    await assert.rejects(
      () => VariationService.crear(t.business, product, { attributeValueIds: [t.azul.id, t.S.id] }, t.user.id),
      VariationError as any
    )
    await assert.rejects(
      () => VariationService.crear(t.business, product, { attributeValueIds: [otra.S.id] }, t.user.id),
      VariationError as any
    )
    await assert.rejects(
      () => VariationService.crear(t.business, product, { attributeValueIds: [] }, t.user.id),
      VariationError as any
    )
  })

  test('flujo en dos pasos del editor: al asignar atributos se traslada el stock una sola vez', async ({
    client,
    assert,
  }) => {
    const t = await crearTienda()
    const { product, oculta } = await productoSimple(t, 7)
    const base = `/api/b/${t.business.uuid}`

    const creada = await client
      .post(`${base}/product-variations`)
      .json({ product_id: product.id, price: 39.9, stock: 0 })
      .loginAs(t.user)
    creada.assertStatus(200)
    const id = creada.body().data.id

    const sync = () =>
      client
        .post(`${base}/product-variation-attributes`)
        .json({ variationId: id, attributeValueIds: [t.S.id] })
        .loginAs(t.user)

    ;(await sync()).assertStatus(200)
    ;(await sync()).assertStatus(200) // repetir no duplica

    await oculta.refresh()
    const v = await ProductVariation.findOrFail(id)
    assert.equal(oculta.stock, 0)
    assert.equal(v.stock, 7)
    assert.equal(await stockProducto(product.id), 7)
  })

  test('la variación oculta retirada no aparece en alertas de stock bajo', async ({ assert }) => {
    const t = await crearTienda()
    const { product } = await productoSimple(t, 2)
    await VariationService.crear(t.business, product, { attributeValueIds: [t.S.id] }, t.user.id)
    await VariationService.crear(t.business, product, { attributeValueIds: [t.M.id] }, t.user.id)

    const alertas = await InventoryService.lowStock(t.business.id)

    // S tiene 2 (≤ 3) y M tiene 0: las dos, y ninguna es la oculta.
    assert.lengthOf(alertas, 2)
    assert.isTrue(alertas.every((a) => !a.isDefault))
    // Regresión del join: el stock y el id son los de la variación, no los del producto.
    assert.deepEqual(
      alertas.map((a) => a.stock).sort(),
      [0, 2]
    )
    assert.isTrue(alertas.every((a) => a.id !== product.id || a.productId === product.id))
  })
})

test.group('Compras con costo por variante', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function conTallas() {
    const t = await crearTienda()
    const { product } = await productoSimple(t, 0)
    const s = await VariationService.crear(t.business, product, { attributeValueIds: [t.S.id] }, t.user.id)
    const m = await VariationService.crear(t.business, product, { attributeValueIds: [t.M.id] }, t.user.id)
    return { t, product, s, m }
  }

  test('recibir suma el stock por variante y guarda su costo sin tocar el precio de venta', async ({
    assert,
  }) => {
    const { t, product, s, m } = await conTallas()

    const orden = await PurchaseService.crearOrden(
      t.business,
      {
        supplierId: t.supplier.id,
        items: [
          { variationId: s.id, quantity: 10, unitCost: 15 },
          { variationId: m.id, quantity: 5, unitCost: 17.5 },
        ],
      },
      t.user.id
    )
    assert.equal(Number(orden.total), 237.5)

    // Antes de recibir no hay stock: pedir no es tener.
    assert.equal(await stockProducto(product.id), 0)

    await PurchaseService.recibir(t.business, orden.id, t.user.id)
    await s.refresh()
    await m.refresh()

    assert.equal(s.stock, 10)
    assert.equal(m.stock, 5)
    assert.equal(Number(s.cost), 15)
    assert.equal(Number(m.cost), 17.5)
    assert.equal(Number(s.price), 39.9)
    assert.equal(Number(m.price), 39.9)
    assert.equal(await stockProducto(product.id), 15)

    const compras = await StockMovement.query()
      .where('business_id', t.business.id)
      .where('type', 'compra')
    assert.lengthOf(compras, 2)
  })

  test('una orden no se recibe dos veces', async ({ assert }) => {
    const { t, product, s } = await conTallas()
    const orden = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.supplier.id, items: [{ variationId: s.id, quantity: 4, unitCost: 10 }] },
      t.user.id
    )

    await PurchaseService.recibir(t.business, orden.id, t.user.id)
    await assert.rejects(() => PurchaseService.recibir(t.business, orden.id, t.user.id), PurchaseError as any)

    assert.equal(await stockProducto(product.id), 4)
  })

  test('no se compra la variación oculta de un producto que ya tiene tallas', async ({ assert }) => {
    const { t, product } = await conTallas()
    const oculta = await ProductVariation.query()
      .where('product_id', product.id)
      .where('is_default', true)
      .firstOrFail()

    await assert.rejects(
      () =>
        PurchaseService.crearOrden(
          t.business,
          { supplierId: t.supplier.id, items: [{ variationId: oculta.id, quantity: 1, unitCost: 1 }] },
          t.user.id
        ),
      PurchaseError as any
    )
  })

  test('un producto simple sí se puede comprar por su variación única', async ({ assert }) => {
    const t = await crearTienda()
    const { product, oculta } = await productoSimple(t, 3)

    const orden = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.supplier.id, items: [{ variationId: oculta.id, quantity: 2, unitCost: 12 }] },
      t.user.id
    )
    await PurchaseService.recibir(t.business, orden.id, t.user.id)

    assert.equal(await stockProducto(product.id), 5)
  })

  test('cancelar una orden en borrador no toca el inventario', async ({ assert }) => {
    const { t, product, s } = await conTallas()
    const orden = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.supplier.id, items: [{ variationId: s.id, quantity: 9, unitCost: 10 }] },
      t.user.id
    )
    await PurchaseService.cancelarOrden(t.business, orden.id)

    assert.equal(await stockProducto(product.id), 0)
  })

  test('cantidades y costos inválidos se rechazan sin dejar la orden a medias', async ({ assert }) => {
    const { t, s } = await conTallas()

    await assert.rejects(
      () =>
        PurchaseService.crearOrden(
          t.business,
          { supplierId: t.supplier.id, items: [{ variationId: s.id, quantity: 0, unitCost: 10 }] },
          t.user.id
        ),
      PurchaseError as any
    )
  })
})

test.group('Alta de producto desde Compras', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crea el producto con sus variaciones en una sola llamada y stock 0', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`

    const res = await client
      .post(`${base}/products/quick`)
      .json({
        name: 'Casaca Denim',
        price: 120,
        cost: 70,
        variations: [
          { attributeValueIds: [t.S.id, t.azul.id] },
          { attributeValueIds: [t.M.id, t.azul.id] },
        ],
      })
      .loginAs(t.user)

    res.assertStatus(201)
    const data = res.body().data
    assert.lengthOf(data.variations, 2)
    assert.isTrue(data.variations.every((v: any) => v.stock === 0 && Number(v.price) === 120))

    // Nace sin variación oculta: no hay stock simple que arrastrar.
    const ocultas = await ProductVariation.query().where('product_id', data.id).where('is_default', true)
    assert.lengthOf(ocultas, 0)

    // Y se puede comprar enseguida.
    const orden = await client
      .post(`${base}/purchases`)
      .json({
        supplierId: t.supplier.id,
        items: data.variations.map((v: any) => ({ variationId: v.id, quantity: 6, unitCost: 70 })),
      })
      .loginAs(t.user)
    orden.assertStatus(201)
    ;(await client.post(`${base}/purchases/${orden.body().data.id}/receive`).loginAs(t.user)).assertStatus(200)

    assert.equal(await stockProducto(data.id), 12)
  })

  test('sin variaciones nace como producto simple', async ({ client, assert }) => {
    const t = await crearTienda()

    const res = await client
      .post(`/api/b/${t.business.uuid}/products/quick`)
      .json({ name: 'Cargador', price: 25 })
      .loginAs(t.user)

    res.assertStatus(201)
    const v = res.body().data.variations
    assert.lengthOf(v, 1)
    assert.isTrue(v[0].isDefault)
  })

  test('si una variación falla no queda el producto a medias', async ({ client, assert }) => {
    const t = await crearTienda()
    const otra = await crearTienda()

    const res = await client
      .post(`/api/b/${t.business.uuid}/products/quick`)
      .json({
        name: 'Fantasma',
        price: 10,
        variations: [{ attributeValueIds: [t.S.id] }, { attributeValueIds: [otra.S.id] }],
      })
      .loginAs(t.user)

    res.assertStatus(422)
    const huerfano = await Product.query().where('business_id', t.business.id).where('name', 'Fantasma')
    assert.lengthOf(huerfano, 0)
  })

  test('agregar una talla a un producto existente desde Compras (camino atómico)', async ({
    client,
    assert,
  }) => {
    const t = await crearTienda()
    const { product } = await productoSimple(t, 4)
    const base = `/api/b/${t.business.uuid}`

    const res = await client
      .post(`${base}/product-variations`)
      .json({ product_id: product.id, attributeValueIds: [t.S.id], cost: 11 })
      .loginAs(t.user)

    res.assertStatus(200)
    assert.equal(Number(res.body().data.price), 39.9)
    assert.equal(res.body().data.stock, 4) // el stock del simple pasó aquí
    assert.equal(await stockProducto(product.id), 4)
  })

  test('otra tienda no puede agregar variaciones a mi producto', async ({ client }) => {
    const t = await crearTienda()
    const intruso = await crearTienda()
    const { product } = await productoSimple(t, 0)

    const res = await client
      .post(`/api/b/${intruso.business.uuid}/product-variations`)
      .json({ product_id: product.id, attributeValueIds: [intruso.S.id] })
      .loginAs(intruso.user)

    res.assertStatus(422)
  })
})
