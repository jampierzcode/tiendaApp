import Business from '#models/business'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import ReturnItem from '#models/return_item'
import ReturnNote from '#models/return_note'
import Role from '#models/role'
import User from '#models/user'
import ReportService, { ZONA_REPORTES } from '#services/report_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

// El día se calcula en la zona de los reportes, no en la del proceso: a las
// 8pm en Lima el servidor en UTC ya está en el día siguiente.
const HOY = DateTime.now().setZone(ZONA_REPORTES).toFormat('yyyy-MM-dd')
const RANGO = { desde: HOY, hasta: HOY }

async function crearTienda() {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
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
    name: `Tienda ${sufijo}`,
    userId: user.id,
    status: 'activo',
  })

  const product = await Product.create({
    businessId: business.id,
    name: 'Polo Básico',
    slug: `polo-${sufijo}`,
    price: 100,
    cost: 40,
    taxRate: 18,
    lowStockThreshold: 5,
    stock: 0,
    status: 'activo',
  })

  const variation = await ProductVariation.create({
    businessId: business.id,
    productId: product.id,
    isDefault: true,
    price: 100,
    stock: 100,
  })

  return { business, user, product, variation }
}

/** Un pedido con N unidades a 100 y costo 40. */
async function crearPedido(
  ctx: Awaited<ReturnType<typeof crearTienda>>,
  cantidad: number,
  status: any = 'pagado'
) {
  const order = await Order.create({
    businessId: ctx.business.id,
    code: `P-${randomUUID().slice(0, 6)}`,
    channel: 'mostrador',
    status,
    customerName: 'Cliente',
    customerPhone: '999',
    deliveryMethod: 'recojo',
    currency: 'PEN',
    subtotal: 100 * cantidad,
    discountTotal: 0,
    shippingCost: 0,
    total: 100 * cantidad,
    paidTotal: 100 * cantidad,
    stockCommittedAt: DateTime.now(),
  })

  const item = await OrderItem.create({
    businessId: ctx.business.id,
    orderId: order.id,
    productId: ctx.product.id,
    productVariationId: ctx.variation.id,
    productName: ctx.product.name,
    unitPrice: 100,
    unitCost: 40,
    discountPercentage: 0,
    quantity: cantidad,
    lineTotal: 100 * cantidad,
  })

  return { order, item }
}

async function crearDevolucion(
  ctx: Awaited<ReturnType<typeof crearTienda>>,
  order: Order,
  item: OrderItem,
  cantidad: number
) {
  const devolucion = await ReturnNote.create({
    businessId: ctx.business.id,
    orderId: order.id,
    code: `DV-${randomUUID().slice(0, 6)}`,
    restocked: true,
    total: 100 * cantidad,
  })

  await ReturnItem.create({
    businessId: ctx.business.id,
    returnId: devolucion.id,
    orderItemId: item.id,
    quantity: cantidad,
    lineTotal: 100 * cantidad,
  })

  return devolucion
}

test.group('Reportes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el margen sale del costo guardado en la línea del pedido', async ({ assert }) => {
    const ctx = await crearTienda()
    await crearPedido(ctx, 3)

    const r = await ReportService.resumen(ctx.business.id, RANGO)

    assert.equal(r.vendido, 300)
    assert.equal(r.costo, 120)
    assert.equal(r.margen, 180)
    assert.equal(r.margenPorcentaje, 60)
    assert.equal(r.unidades, 3)
    assert.equal(r.ticketPromedio, 300)
  })

  test('una devolución parcial resta del neto una sola vez', async ({ assert }) => {
    const ctx = await crearTienda()
    const { order, item } = await crearPedido(ctx, 3)
    await crearDevolucion(ctx, order, item, 1)

    const r = await ReportService.resumen(ctx.business.id, RANGO)

    // El pedido sigue contando como venta (3 × 100) y la devolución resta 100.
    assert.equal(r.vendido, 300)
    assert.equal(r.devuelto, 100)
    assert.equal(r.neto, 200)
    assert.equal(r.unidades, 2)
  })

  test('un pedido devuelto entero no se descuenta dos veces', async ({ assert }) => {
    const ctx = await crearTienda()
    const { order, item } = await crearPedido(ctx, 2, 'devuelto')
    await crearDevolucion(ctx, order, item, 2)

    const r = await ReportService.resumen(ctx.business.id, RANGO)

    // El pedido está en estado devuelto, así que ya está fuera del lado de las
    // ventas. Restar además sus devoluciones lo descontaría por partida doble
    // y el neto saldría negativo.
    assert.equal(r.vendido, 0, 'un pedido devuelto no cuenta como venta')
    assert.equal(r.devuelto, 0, 'y su devolución tampoco vuelve a restar')
    assert.equal(r.neto, 0)
  })

  test('los pedidos cancelados no cuentan', async ({ assert }) => {
    const ctx = await crearTienda()
    await crearPedido(ctx, 5, 'cancelado')
    await crearPedido(ctx, 2)

    const r = await ReportService.resumen(ctx.business.id, RANGO)

    assert.equal(r.vendido, 200)
    assert.equal(r.pedidos, 1)
  })

  test('el resumen y el detalle por producto cuadran', async ({ assert }) => {
    const ctx = await crearTienda()
    const { order, item } = await crearPedido(ctx, 4)
    await crearDevolucion(ctx, order, item, 1)

    const resumen = await ReportService.resumen(ctx.business.id, RANGO)
    const productos = await ReportService.productosTop(ctx.business.id, RANGO)

    assert.lengthOf(productos, 1)
    assert.equal(productos[0].unidades, 3, 'las devueltas ya están descontadas')
    assert.equal(productos[0].devueltas, 1)
    assert.equal(productos[0].ingresos, resumen.neto)
    assert.equal(productos[0].margen, resumen.margen)
  })

  test('cada tienda solo ve sus propias cifras', async ({ assert }) => {
    const propia = await crearTienda()
    const ajena = await crearTienda()

    await crearPedido(propia, 2)
    await crearPedido(ajena, 9)

    const r = await ReportService.resumen(propia.business.id, RANGO)

    assert.equal(r.vendido, 200, 'no debe sumar las ventas de la otra tienda')
  })

  test('la serie agrupa por día y suma lo mismo que el resumen', async ({ assert }) => {
    const ctx = await crearTienda()
    await crearPedido(ctx, 2)
    await crearPedido(ctx, 3)

    const resumen = await ReportService.resumen(ctx.business.id, RANGO)
    const serie = await ReportService.serieVentas(ctx.business.id, RANGO, 'day')

    const sumaSerie = serie.reduce((t, p) => t + p.neto, 0)

    assert.equal(sumaSerie, resumen.neto)
  })
})
