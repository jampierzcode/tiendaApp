import Business from '#models/business'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import StockMovement from '#models/stock_movement'
import User from '#models/user'
import InventoryService, { InsufficientStockError } from '#services/inventory_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

async function crearVariacion(stockInicial: number) {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  // El nombre lleva sufijo porque `users.name` tiene índice UNIQUE en la
  // base (ver hallazgo pendiente: dos empleados no pueden llamarse igual).
  const sufijo = randomUUID()
  const user = await User.create({
    name: `Dueña ${sufijo}`,
    email: `duena-${sufijo}@test.pe`,
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

  const product = await Product.create({
    businessId: business.id,
    name: 'Polo Básico',
    slug: `polo-${randomUUID()}`,
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
    stock: 0,
  })

  if (stockInicial) {
    await InventoryService.applyMovement({
      businessId: business.id,
      variationId: variation.id,
      type: 'inicial',
      quantity: stockInicial,
    })
    await variation.refresh()
  }

  return { business, product, variation }
}

test.group('Kardex de inventario', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('cada movimiento deja su rastro y actualiza el saldo', async ({ assert }) => {
    const { business, variation } = await crearVariacion(20)

    await InventoryService.applyMovement({
      businessId: business.id,
      variationId: variation.id,
      type: 'venta',
      quantity: -3,
    })

    await variation.refresh()
    assert.equal(variation.stock, 17)

    const movimientos = await StockMovement.query()
      .where('product_variation_id', variation.id)
      .orderBy('id', 'asc')

    assert.lengthOf(movimientos, 2)
    assert.equal(movimientos[1].quantity, -3)
    assert.equal(movimientos[1].balanceAfter, 17)
  })

  test('la suma del kardex siempre iguala el saldo', async ({ assert }) => {
    const { business, variation } = await crearVariacion(20)

    for (const cantidad of [-5, 8, -2, -1]) {
      await InventoryService.applyMovement({
        businessId: business.id,
        variationId: variation.id,
        type: cantidad > 0 ? 'compra' : 'venta',
        quantity: cantidad,
      })
    }

    await variation.refresh()

    const movimientos = await StockMovement.query().where('product_variation_id', variation.id)
    const suma = movimientos.reduce((total, m) => total + m.quantity, 0)

    assert.equal(suma, variation.stock)
  })

  test('una salida no puede dejar el stock en negativo', async ({ assert }) => {
    const { business, variation } = await crearVariacion(5)

    let capturado: unknown
    try {
      await InventoryService.applyMovement({
        businessId: business.id,
        variationId: variation.id,
        type: 'venta',
        quantity: -6,
      })
    } catch (error) {
      capturado = error
    }

    assert.instanceOf(capturado, InsufficientStockError)

    await variation.refresh()
    assert.equal(variation.stock, 5, 'el saldo no debe haberse tocado')
  })

  test('el total del producto se recalcula solo', async ({ assert }) => {
    const { business, product, variation } = await crearVariacion(20)

    const segunda = await ProductVariation.create({
      businessId: business.id,
      productId: product.id,
      isDefault: false,
      price: 39.9,
      stock: 0,
    })

    await InventoryService.applyMovement({
      businessId: business.id,
      variationId: segunda.id,
      type: 'compra',
      quantity: 12,
    })

    await product.refresh()
    assert.equal(product.stock, 32, 'el total del producto es la suma de sus variaciones')
    assert.equal(variation.stock + 12, 32)
  })

  test('el ajuste manual fija el saldo y registra la diferencia', async ({ assert }) => {
    const { business, variation } = await crearVariacion(20)

    await InventoryService.setStock({
      businessId: business.id,
      variationId: variation.id,
      newStock: 8,
      note: 'conteo físico',
    })

    await variation.refresh()
    assert.equal(variation.stock, 8)

    const ajuste = await StockMovement.query()
      .where('product_variation_id', variation.id)
      .andWhere('type', 'ajuste')
      .firstOrFail()

    assert.equal(ajuste.quantity, -12)
    assert.equal(ajuste.balanceAfter, 8)
  })

  test('no se puede mover el inventario de otra tienda', async ({ assert }) => {
    const ajena = await crearVariacion(20)
    const propia = await crearVariacion(20)

    await assert.rejects(() =>
      InventoryService.applyMovement({
        businessId: propia.business.id,
        variationId: ajena.variation.id,
        type: 'venta',
        quantity: -1,
      })
    )
  })
})
