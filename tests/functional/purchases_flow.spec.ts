import Business from '#models/business'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import PriceReview from '#models/price_review'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import PurchaseOrder from '#models/purchase_order'
import PurchaseOrderItem from '#models/purchase_order_item'
import Role from '#models/role'
import StockMovement from '#models/stock_movement'
import Supplier from '#models/supplier'
import User from '#models/user'
import InventoryService from '#services/inventory_service'
import PriceService from '#services/price_service'
import PurchaseService, { PurchaseError } from '#services/purchase_service'
import ShipmentService, { ShipmentError } from '#services/shipment_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/**
 * Compras por proveedor: cotización, recepciones parciales, historial de
 * costos, revisión de precios, envíos y alertas con stock por llegar.
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
  const proveedorA = await Supplier.create({ businessId: business.id, name: 'Gamarra A', status: 'activo' })
  const proveedorB = await Supplier.create({ businessId: business.id, name: 'Gamarra B', status: 'activo' })

  const product = await Product.create({
    businessId: business.id,
    name: 'Polo Básico',
    slug: `polo-${randomUUID()}`,
    price: 40,
    cost: 20,
    taxRate: 18,
    lowStockThreshold: 5,
    stock: 0,
    status: 'activo',
  })
  const variation = await ProductVariation.create({
    businessId: business.id,
    productId: product.id,
    isDefault: true,
    price: 40,
    cost: 20,
    stock: 0,
  })
  return { user, business, proveedorA, proveedorB, product, variation }
}

const stockDe = async (id: number) => (await ProductVariation.findOrFail(id)).stock
const itemsDe = (ordenId: number) => PurchaseOrderItem.query().where('purchase_order_id', ordenId)

test.group('Cotización', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('una cotización no genera stock, ni cambia costos, ni se puede recibir', async ({ assert }) => {
    const t = await crearTienda()
    const cot = await PurchaseService.crearOrden(
      t.business,
      {
        supplierId: t.proveedorA.id,
        tipo: 'cotizacion',
        items: [{ variationId: t.variation.id, quantity: 10, unitCost: 99 }],
      },
      t.user.id
    )

    assert.equal(cot.status, 'cotizacion')
    assert.match(cot.code, /^CT-/)
    assert.equal(await stockDe(t.variation.id), 0)
    assert.equal(Number((await ProductVariation.findOrFail(t.variation.id)).cost), 20)
    assert.equal(Number((await Product.findOrFail(t.product.id)).cost), 20)

    await assert.rejects(() => PurchaseService.recibir(t.business, cot.id, t.user.id), PurchaseError as any)
    const [lineaCot] = await itemsDe(cot.id)
    await assert.rejects(
      () =>
        PurchaseService.recibirParcial(
          t.business,
          cot.id,
          { items: [{ itemId: lineaCot.id, quantity: 1 }] },
          t.user.id
        ),
      PurchaseError as any
    )
    assert.lengthOf(await StockMovement.query().where('business_id', t.business.id), 0)
  })

  test('la cotización se convierte en pedido (incluso a otro proveedor) y recién ahí espera mercadería', async ({
    assert,
  }) => {
    const t = await crearTienda()
    const cot = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, tipo: 'cotizacion', items: [{ variationId: t.variation.id, quantity: 4, unitCost: 22 }] },
      t.user.id
    )

    const pedido = await PurchaseService.confirmarCotizacion(t.business, cot.id, t.proveedorB.id)
    assert.equal(pedido.status, 'borrador')
    assert.equal(pedido.supplierId, t.proveedorB.id)
    assert.match(pedido.code, /^OC-/)
    assert.equal(await stockDe(t.variation.id), 0)

    // Una orden ya pedida no se vuelve a confirmar.
    await assert.rejects(() => PurchaseService.confirmarCotizacion(t.business, cot.id), PurchaseError as any)
  })

  test('las líneas de una cotización se pueden reemplazar; las de un pedido no', async ({ assert }) => {
    const t = await crearTienda()
    const cot = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, tipo: 'cotizacion', items: [{ variationId: t.variation.id, quantity: 1, unitCost: 30 }] },
      t.user.id
    )

    const editada = await PurchaseService.actualizar(t.business, cot.id, {
      items: [{ variationId: t.variation.id, quantity: 3, unitCost: 25 }],
    })
    assert.equal(Number(editada.total), 75)

    const pedido = await PurchaseService.confirmarCotizacion(t.business, cot.id)
    await assert.rejects(
      () => PurchaseService.actualizar(t.business, pedido.id, { items: [{ variationId: t.variation.id, quantity: 1, unitCost: 1 }] }),
      PurchaseError as any
    )
  })
})

test.group('Recepciones parciales', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function pedido(t: Awaited<ReturnType<typeof crearTienda>>, cantidad = 10, costo = 20) {
    return PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: cantidad, unitCost: costo }] },
      t.user.id
    )
  }

  test('el stock entra solo con lo que llegó, y la orden pasa de parcial a recibida', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await pedido(t, 10)
    const [item] = await itemsDe(orden.id)

    const r1 = await PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 4 }] }, t.user.id)
    assert.equal(r1.orden.status, 'parcial')
    assert.equal(await stockDe(t.variation.id), 4)

    const r2 = await PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 6 }] }, t.user.id)
    assert.equal(r2.orden.status, 'recibida')
    assert.equal(await stockDe(t.variation.id), 10)
    assert.equal((await Product.findOrFail(t.product.id)).stock, 10)
  })

  test('no se puede recibir más de lo pedido ni repetir la recepción completa', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await pedido(t, 5)
    const [item] = await itemsDe(orden.id)

    await assert.rejects(
      () => PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 6 }] }, t.user.id),
      PurchaseError as any
    )
    assert.equal(await stockDe(t.variation.id), 0)

    await PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 5 }] }, t.user.id)
    await assert.rejects(() => PurchaseService.recibir(t.business, orden.id, t.user.id), PurchaseError as any)
    await assert.rejects(
      () => PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 1 }] }, t.user.id),
      PurchaseError as any
    )
    assert.equal(await stockDe(t.variation.id), 5)
  })

  test('«recibir todo» después de una parcial solo trae lo que falta', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await pedido(t, 10)
    const [item] = await itemsDe(orden.id)

    await PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 3 }] }, t.user.id)
    const final = await PurchaseService.recibir(t.business, orden.id, t.user.id)

    assert.equal(final.status, 'recibida')
    assert.equal(await stockDe(t.variation.id), 10)
  })

  test('recepción inválida (cero, línea ajena o repetida) no deja nada a medias', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await pedido(t, 5)
    const otra = await pedido(t, 5)
    const [item] = await itemsDe(orden.id)
    const [ajena] = await itemsDe(otra.id)

    await assert.rejects(
      () => PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 0 }] }, t.user.id),
      PurchaseError as any
    )
    await assert.rejects(
      () => PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: ajena.id, quantity: 1 }] }, t.user.id),
      PurchaseError as any
    )
    await assert.rejects(
      () =>
        PurchaseService.recibirParcial(
          t.business,
          orden.id,
          { items: [{ itemId: item.id, quantity: 1 }, { itemId: item.id, quantity: 1 }] },
          t.user.id
        ),
      PurchaseError as any
    )
    assert.equal(await stockDe(t.variation.id), 0)
    assert.equal((await PurchaseOrderItem.findOrFail(item.id)).receivedQuantity, 0)
  })

  test('cerrar una orden parcial deja de esperar lo faltante', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await pedido(t, 10)
    const [item] = await itemsDe(orden.id)
    await PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 7 }] }, t.user.id)

    await assert.rejects(() => PurchaseService.cancelarOrden(t.business, orden.id), PurchaseError as any)
    const cerrada = await PurchaseService.cerrar(t.business, orden.id, 'El proveedor no tiene más')

    assert.equal(cerrada.status, 'recibida')
    assert.equal(await stockDe(t.variation.id), 7)
    assert.lengthOf(await InventoryService.lowStock(t.business.id), 0)
  })

  test('cambiar de proveedor se permite antes de recibir y no después', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await pedido(t, 4)
    const [item] = await itemsDe(orden.id)

    const cambiada = await PurchaseService.actualizar(t.business, orden.id, { supplierId: t.proveedorB.id })
    assert.equal(cambiada.supplierId, t.proveedorB.id)

    await PurchaseService.recibirParcial(t.business, orden.id, { items: [{ itemId: item.id, quantity: 1 }] }, t.user.id)
    await assert.rejects(
      () => PurchaseService.actualizar(t.business, orden.id, { supplierId: t.proveedorA.id }),
      PurchaseError as any
    )
    // Una orden de otra tienda no sirve de proveedor.
    const otra = await crearTienda()
    await assert.rejects(
      () => PurchaseService.crearOrden(t.business, { supplierId: otra.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 1, unitCost: 1 }] }, t.user.id),
      PurchaseError as any
    )
  })
})

test.group('Costos históricos y revisión de precio', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function comprar(
    t: Awaited<ReturnType<typeof crearTienda>>,
    proveedorId: number,
    costo: number,
    cantidad = 1
  ) {
    const orden = await PurchaseService.crearOrden(
      t.business,
      { supplierId: proveedorId, items: [{ variationId: t.variation.id, quantity: cantidad, unitCost: costo }] },
      t.user.id
    )
    return PurchaseService.recibir(t.business, orden.id, t.user.id)
  }

  test('el historial separa lo que cobró cada proveedor y lo cotizado', async ({ assert }) => {
    const t = await crearTienda()
    await comprar(t, t.proveedorA.id, 20)
    await comprar(t, t.proveedorA.id, 24)
    await comprar(t, t.proveedorB.id, 19)
    await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorB.id, tipo: 'cotizacion', items: [{ variationId: t.variation.id, quantity: 1, unitCost: 17 }] },
      t.user.id
    )

    const h = await PurchaseService.historialCostos(t.business, { variationId: t.variation.id })
    const a = h.proveedores.find((p: any) => p.supplierId === t.proveedorA.id)!
    const b = h.proveedores.find((p: any) => p.supplierId === t.proveedorB.id)!

    assert.equal(a.compras, 2)
    assert.equal(a.ultimoCosto, 24)
    assert.equal(a.minimo, 20)
    assert.equal(a.promedio, 22)
    assert.equal(b.compras, 1)
    assert.equal(b.ultimoCosto, 19)
    assert.equal(b.cotizado?.costo, 17)
  })

  test('cambiar de proveedor una orden pendiente no borra lo que ya cobró el anterior', async ({ assert }) => {
    const t = await crearTienda()
    await comprar(t, t.proveedorA.id, 21)
    const pendiente = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 2, unitCost: 25 }] },
      t.user.id
    )
    await PurchaseService.actualizar(t.business, pendiente.id, { supplierId: t.proveedorB.id })

    const h = await PurchaseService.historialCostos(t.business, { variationId: t.variation.id })
    const a = h.proveedores.find((p: any) => p.supplierId === t.proveedorA.id)!
    assert.equal(a.compras, 1)
    assert.equal(a.ultimoCosto, 21)
  })

  test('si el costo sube solo se sugiere revisar el precio: no se cambia', async ({ assert }) => {
    const t = await crearTienda() // costo 20, precio 40 → margen 50 %
    await comprar(t, t.proveedorA.id, 30)

    assert.equal(Number((await Product.findOrFail(t.product.id)).price), 40)
    assert.equal(Number((await ProductVariation.findOrFail(t.variation.id)).price), 40)

    const revisiones = await PriceReview.query().where('business_id', t.business.id)
    assert.lengthOf(revisiones, 1)
    assert.equal(revisiones[0].status, 'pendiente')
    assert.equal(Number(revisiones[0].oldCost), 20)
    assert.equal(Number(revisiones[0].newCost), 30)
    // Mantiene el 50 % de margen: 30 / 0.5 = 60.
    assert.equal(Number(revisiones[0].suggestedPrice), 60)
  })

  test('si el costo baja o se repite no hay revisión', async ({ assert }) => {
    const t = await crearTienda()
    await comprar(t, t.proveedorA.id, 20)
    await comprar(t, t.proveedorA.id, 18)

    assert.lengthOf(await PriceReview.query().where('business_id', t.business.id), 0)
  })

  test('varias subidas seguidas mantienen una sola revisión abierta', async ({ assert }) => {
    const t = await crearTienda()
    await comprar(t, t.proveedorA.id, 25)
    await comprar(t, t.proveedorA.id, 28)

    const abiertas = await PriceReview.query().where('business_id', t.business.id).where('status', 'pendiente')
    assert.lengthOf(abiertas, 1)
    assert.equal(Number(abiertas[0].newCost), 28)
  })

  test('cambiar el precio pide confirmación y no toca las ventas pasadas', async ({ assert }) => {
    const t = await crearTienda()
    await comprar(t, t.proveedorA.id, 30)

    const pedido = await Order.create({
      businessId: t.business.id,
      code: `P-${randomUUID().slice(0, 6)}`,
      customerName: 'Ana',
    } as any)
    const linea = await OrderItem.create({
      businessId: t.business.id,
      orderId: pedido.id,
      productName: 'Polo Básico',
      unitPrice: 40,
      unitCost: 20,
      quantity: 2,
      lineTotal: 80,
    } as any)

    // Sin confirmar: solo vista previa.
    const previa = await PriceService.aplicar(t.business, t.product.id, 60, { confirm: false, userId: t.user.id })
    assert.isFalse(previa.aplicado)
    assert.equal(Number((await Product.findOrFail(t.product.id)).price), 40)

    const hecho = await PriceService.aplicar(t.business, t.product.id, 60, { confirm: true, userId: t.user.id })
    assert.isTrue(hecho.aplicado)
    assert.equal(Number((await Product.findOrFail(t.product.id)).price), 60)
    assert.equal(Number((await ProductVariation.findOrFail(t.variation.id)).price), 60)

    // La venta de antes conserva su precio y su costo.
    const intacta = await OrderItem.findOrFail(linea.id)
    assert.equal(Number(intacta.unitPrice), 40)
    assert.equal(Number(intacta.unitCost), 20)
    assert.equal(Number(intacta.lineTotal), 80)

    // La revisión pendiente queda resuelta.
    const pendientes = await PriceReview.query().where('business_id', t.business.id).where('status', 'pendiente')
    assert.lengthOf(pendientes, 0)
  })

  test('la API exige confirm:true para aplicar un precio', async ({ client, assert }) => {
    const t = await crearTienda()
    const base = `/api/b/${t.business.uuid}`

    const previa = await client.post(`${base}/products/${t.product.id}/price`).json({ price: 55 }).loginAs(t.user)
    previa.assertStatus(200)
    assert.isTrue(previa.body().requiresConfirmation)
    assert.equal(Number((await Product.findOrFail(t.product.id)).price), 40)

    const ok = await client
      .post(`${base}/products/${t.product.id}/price`)
      .json({ price: 55, confirm: true })
      .loginAs(t.user)
    ok.assertStatus(200)
    assert.equal(Number((await Product.findOrFail(t.product.id)).price), 55)

    // Otra tienda no puede tocar este producto.
    const intruso = await crearTienda()
    const res = await client
      .post(`/api/b/${intruso.business.uuid}/products/${t.product.id}/price`)
      .json({ price: 1, confirm: true })
      .loginAs(intruso.user)
    assert.notEqual(res.status(), 200)
    assert.equal(Number((await Product.findOrFail(t.product.id)).price), 55)
  })
})

test.group('Envíos y alertas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el envío de una compra lleva estados, fechas y enlace, pero no suma stock', async ({ assert }) => {
    const t = await crearTienda()
    const orden = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 8, unitCost: 20 }] },
      t.user.id
    )

    const envio = await ShipmentService.crear(
      t.business,
      {
        kind: 'compra',
        purchaseOrderId: orden.id,
        carrier: 'Olva',
        trackingCode: 'OL-123',
        trackingUrl: 'https://ejemplo.pe/rastreo?c=OL-123',
        estimatedAt: '2026-10-25',
      },
      t.user.id
    )
    assert.equal(envio.status, 'preparando')

    const enCamino = await ShipmentService.cambiarEstado(t.business, envio.id, 'en_transito', t.user.id, 'Salió de Lima')
    assert.isNotNull(enCamino.shippedAt)
    const llego = await ShipmentService.cambiarEstado(t.business, envio.id, 'entregado', t.user.id)
    assert.isNotNull(llego.deliveredAt)

    // "Entregado" es solo seguimiento: el stock sube al registrar la recepción.
    assert.equal(await stockDe(t.variation.id), 0)

    await assert.rejects(
      () => ShipmentService.cambiarEstado(t.business, envio.id, 'en_transito', t.user.id),
      ShipmentError as any
    )

    const [item] = await itemsDe(orden.id)
    const r = await PurchaseService.recibirParcial(
      t.business,
      orden.id,
      { items: [{ itemId: item.id, quantity: 3 }], shipmentId: envio.id },
      t.user.id
    )
    assert.equal(r.receipt.shipmentId, envio.id)
    assert.equal(await stockDe(t.variation.id), 3)
  })

  test('rechaza enlaces raros, órdenes ajenas y cotizaciones', async ({ assert }) => {
    const t = await crearTienda()
    const otra = await crearTienda()
    const cot = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, tipo: 'cotizacion', items: [{ variationId: t.variation.id, quantity: 1, unitCost: 1 }] },
      t.user.id
    )
    const orden = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 1, unitCost: 1 }] },
      t.user.id
    )

    await assert.rejects(() => ShipmentService.crear(t.business, { kind: 'compra', purchaseOrderId: cot.id }, t.user.id), ShipmentError as any)
    await assert.rejects(() => ShipmentService.crear(otra.business, { kind: 'compra', purchaseOrderId: orden.id }, otra.user.id), ShipmentError as any)
    await assert.rejects(
      () => ShipmentService.crear(t.business, { kind: 'compra', purchaseOrderId: orden.id, trackingUrl: 'javascript:alert(1)' }, t.user.id),
      ShipmentError as any
    )
  })

  test('envío propio de un pedido a un cliente', async ({ assert }) => {
    const t = await crearTienda()
    const pedido = await Order.create({
      businessId: t.business.id,
      code: `P-${randomUUID().slice(0, 6)}`,
      customerName: 'Luis',
    } as any)

    const envio = await ShipmentService.crear(t.business, { kind: 'pedido', orderId: pedido.id, carrier: 'Shalom' }, t.user.id)
    const hecho = await ShipmentService.cambiarEstado(t.business, envio.id, 'incidencia', t.user.id, 'Cliente no estaba')
    assert.equal(hecho.status, 'incidencia')
  })

  test('las alertas cuentan lo que viene en camino', async ({ assert }) => {
    const t = await crearTienda() // mínimo 5
    await InventoryService.applyMovement({
      businessId: t.business.id,
      variationId: t.variation.id,
      type: 'inicial',
      quantity: 2,
    })

    // Sin nada pendiente: 2 ≤ 5 → alerta.
    assert.lengthOf(await InventoryService.lowStock(t.business.id), 1)

    // Una cotización no cuenta como stock por llegar.
    await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, tipo: 'cotizacion', items: [{ variationId: t.variation.id, quantity: 50, unitCost: 1 }] },
      t.user.id
    )
    assert.lengthOf(await InventoryService.lowStock(t.business.id), 1)

    // Pedido que cubre el faltante: 2 + 10 > 5 → ya no alerta.
    const cubre = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 10, unitCost: 20 }] },
      t.user.id
    )
    assert.lengthOf(await InventoryService.lowStock(t.business.id), 0)

    // Cancelarlo vuelve a dejar la alerta, con 0 pendiente.
    await PurchaseService.cancelarOrden(t.business, cubre.id)
    const sin = await InventoryService.lowStock(t.business.id)
    assert.lengthOf(sin, 1)
    assert.equal(sin[0].$extras.pendiente, 0)

    // Pedido que cubre solo en parte: 2 + 2 ≤ 5 → alerta y muestra el pendiente.
    const parcial = await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 2, unitCost: 20 }] },
      t.user.id
    )
    const alertas = await InventoryService.lowStock(t.business.id)
    assert.lengthOf(alertas, 1)
    assert.equal(alertas[0].$extras.pendiente, 2)

    // Al llegar físicamente, el pendiente baja y el stock sube: no se cuenta dos veces.
    const [item] = await itemsDe(parcial.id)
    await PurchaseService.recibirParcial(t.business, parcial.id, { items: [{ itemId: item.id, quantity: 1 }] }, t.user.id)
    const despues = await InventoryService.lowStock(t.business.id)
    assert.equal(despues[0].stock, 3)
    assert.equal(despues[0].$extras.pendiente, 1)
  })

  test('la API de alertas devuelve lo pendiente', async ({ client, assert }) => {
    const t = await crearTienda()
    await PurchaseService.crearOrden(
      t.business,
      { supplierId: t.proveedorA.id, items: [{ variationId: t.variation.id, quantity: 2, unitCost: 20 }] },
      t.user.id
    )
    const res = await client.get(`/api/b/${t.business.uuid}/inventory/low-stock`).loginAs(t.user)
    res.assertStatus(200)
    assert.equal(res.body().data[0].pendiente, 2)
  })

  test('datos de otra tienda no se ven en compras ni envíos', async ({ client, assert }) => {
    const t = await crearTienda()
    const intruso = await crearTienda()
    const orden = await PurchaseOrder.create({
      businessId: t.business.id,
      supplierId: t.proveedorA.id,
      code: 'OC-99999',
      status: 'borrador',
      total: 0,
    } as any)

    const res = await client.get(`/api/b/${intruso.business.uuid}/purchases/${orden.id}`).loginAs(intruso.user)
    assert.equal(res.status(), 404)
  })
})
