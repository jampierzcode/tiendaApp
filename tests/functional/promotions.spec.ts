import Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Discount from '#models/discount'
import Order from '#models/order'
import OrderItem from '#models/order_item'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'
import Role from '#models/role'
import User from '#models/user'
import OrderService, { OrderError } from '#services/order_service'
import PromotionService from '#services/promotion_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

/**
 * Promociones: descuentos por %, monto fijo, «lleva N paga M» y cupones, con
 * alcance de toda la tienda, una categoría o un producto.
 */

async function montar() {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  const user = await User.create({
    name: `Dueña ${randomUUID()}`,
    email: `${randomUUID()}@test.pe`,
    password: 'secreto123',
    rolId: rol.id,
    status: 'activo',
  })
  const slug = `tienda-${randomUUID().slice(0, 8)}`
  const business = await Business.create({
    uuid: randomUUID(),
    name: 'Modas',
    slug,
    userId: user.id,
    status: 'activo',
    isPublic: true,
    whatsappPhone: '51987654321',
  } as any)

  const verano = await Category.create({ businessId: business.id, name: 'Verano', slug: 'verano' })
  const invierno = await Category.create({ businessId: business.id, name: 'Invierno', slug: 'invierno' })

  async function producto(nombre: string, precio: number, cat: Category) {
    const p = await Product.create({
      businessId: business.id,
      name: nombre,
      slug: `${nombre.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 4)}`,
      price: precio,
      cost: precio / 2,
      taxRate: 18,
      lowStockThreshold: 1,
      stock: 0,
      status: 'activo',
    })
    await CategoryProduct.create({ businessId: business.id, productId: p.id, categoryId: cat.id })
    const v = await ProductVariation.create({
      businessId: business.id,
      productId: p.id,
      isDefault: true,
      price: precio,
      stock: 50,
    })
    return { p, v }
  }

  const polo = await producto('Polo', 100, verano)
  const casaca = await producto('Casaca', 200, invierno)

  const promo = (datos: Record<string, unknown>) =>
    Discount.create({
      businessId: business.id,
      name: 'Promo',
      kind: 'percent',
      value: 0,
      scope: 'all',
      isActive: true,
      ...datos,
    } as any)

  return { user, business, slug, verano, invierno, polo, casaca, promo }
}

const linea = (t: Awaited<ReturnType<typeof montar>>, who: 'polo' | 'casaca', cantidad: number, cat: Category) => ({
  productId: t[who].p.id,
  categoryIds: [cat.id],
  precioUnit: Number(t[who].p.price),
  cantidad,
})

test.group('Cálculo de promociones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('porcentaje, monto fijo y lleva N paga M', async ({ assert }) => {
    const t = await montar()
    const pct = await t.promo({ kind: 'percent', value: 20 })
    const fijo = await t.promo({ kind: 'fixed', value: 15 })
    const dos = await t.promo({ kind: 'bundle', buyQty: 2, payQty: 1 })
    const tres = await t.promo({ kind: 'bundle', buyQty: 3, payQty: 2 })

    assert.equal(PromotionService.ahorroDe(pct, 100, 2), 40)
    assert.equal(PromotionService.ahorroDe(fijo, 100, 3), 45)
    assert.equal(PromotionService.ahorroDe(fijo, 10, 2), 20) // nunca más que el precio
    assert.equal(PromotionService.ahorroDe(dos, 100, 1), 0) // con 1 no hay promo
    assert.equal(PromotionService.ahorroDe(dos, 100, 2), 100)
    assert.equal(PromotionService.ahorroDe(dos, 100, 3), 100) // el tercero se paga
    assert.equal(PromotionService.ahorroDe(dos, 100, 4), 200)
    assert.equal(PromotionService.ahorroDe(tres, 100, 3), 100) // lleva 3 paga 2
    assert.equal(PromotionService.ahorroDe(tres, 100, 5), 100)
  })

  test('en cada línea gana la promoción que más ahorra, sin sumarlas', async ({ assert }) => {
    const t = await montar()
    const p10 = await t.promo({ kind: 'percent', value: 10 })
    const p30 = await t.promo({ kind: 'percent', value: 30 })

    const r = PromotionService.mejorParaLinea([p10, p30], linea(t, 'polo', 1, t.verano))
    assert.equal(r.promo?.id, p30.id)
    assert.equal(r.ahorro, 30)
  })

  test('el alcance limita a la tienda, categoría o producto', async ({ assert }) => {
    const t = await montar()
    const deVerano = await t.promo({ scope: 'category', categoryId: t.verano.id, kind: 'percent', value: 50 })
    const soloCasaca = await t.promo({ scope: 'product', productId: t.casaca.p.id, kind: 'fixed', value: 20 })

    assert.equal(PromotionService.mejorParaLinea([deVerano], linea(t, 'polo', 1, t.verano)).ahorro, 50)
    assert.equal(PromotionService.mejorParaLinea([deVerano], linea(t, 'casaca', 1, t.invierno)).ahorro, 0)
    assert.equal(PromotionService.mejorParaLinea([soloCasaca], linea(t, 'polo', 1, t.verano)).ahorro, 0)
    assert.equal(PromotionService.mejorParaLinea([soloCasaca], linea(t, 'casaca', 1, t.invierno)).ahorro, 20)
  })

  test('vigencia: sin fechas siempre, con rango solo dentro; pausadas no aplican', async ({ assert }) => {
    const t = await montar()
    const hoy = DateTime.now()
    await t.promo({ name: 'siempre', kind: 'percent', value: 5 })
    await t.promo({ name: 'vigente', kind: 'percent', value: 6, startDate: hoy.minus({ days: 2 }), endDate: hoy.plus({ days: 2 }) })
    await t.promo({ name: 'vencida', kind: 'percent', value: 7, startDate: hoy.minus({ days: 9 }), endDate: hoy.minus({ days: 1 }) })
    await t.promo({ name: 'futura', kind: 'percent', value: 8, startDate: hoy.plus({ days: 1 }), endDate: hoy.plus({ days: 5 }) })
    await t.promo({ name: 'pausada', kind: 'percent', value: 9, isActive: false })

    const nombres = (await PromotionService.activas(t.business.id)).map((p) => p.name).sort()
    assert.deepEqual(nombres, ['siempre', 'vigente'])
  })

  test('un cupón solo entra si el cliente escribió su código', async ({ assert }) => {
    const t = await montar()
    await t.promo({ name: 'auto', kind: 'percent', value: 5 })
    await t.promo({ name: 'cupon', kind: 'percent', value: 25, code: 'VERANO25' })

    assert.deepEqual((await PromotionService.activas(t.business.id)).map((p) => p.name), ['auto'])
    assert.deepEqual(
      (await PromotionService.activas(t.business.id, 'verano25')).map((p) => p.name).sort(),
      ['auto', 'cupon']
    )
    assert.isNull(await PromotionService.buscarCupon(t.business.id, 'NOEXISTE'))
    assert.isNotNull(await PromotionService.buscarCupon(t.business.id, ' verano25 '))
  })

  test('precio público: % y monto fijo bajan el precio; N×M solo se etiqueta', async ({ assert }) => {
    const t = await montar()
    const p = await t.promo({ name: '20', kind: 'percent', value: 20 })
    const b = await t.promo({ name: 'dos', kind: 'bundle', buyQty: 2, payQty: 1 })

    const r = PromotionService.precioPublico([p, b], t.polo.p.id, [t.verano.id], 100)
    assert.equal(r.final, 80)
    assert.equal(r.descuento, 20)
    assert.deepEqual(r.etiquetas.map((e) => e.label).sort(), ['2x1', '−20%'])

    const soloBundle = PromotionService.precioPublico([b], t.polo.p.id, [t.verano.id], 100)
    assert.equal(soloBundle.final, 100)
    assert.equal(soloBundle.etiquetas[0].label, '2x1')
  })
})

test.group('Pedidos con promociones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const datos = (_t: Awaited<ReturnType<typeof montar>>, items: any[], extra: object = {}) => ({
    customerName: 'Ana',
    customerPhone: '987654321',
    deliveryMethod: 'recojo' as const,
    items,
    ...extra,
  })

  test('el pedido guarda el precio con promoción y el nombre de la promo', async ({ assert }) => {
    const t = await montar()
    await t.promo({ name: '2x1 polos', scope: 'product', productId: t.polo.p.id, kind: 'bundle', buyQty: 2, payQty: 1 })

    const { order } = await OrderService.crearDesdeTienda(
      t.business,
      datos(t, [{ variationId: t.polo.v.id, quantity: 3 }, { variationId: t.casaca.v.id, quantity: 1 }])
    )

    assert.equal(Number(order.subtotal), 500)
    assert.equal(Number(order.discountTotal), 100)
    assert.equal(Number(order.total), 400)

    const polo = order.items.find((i) => i.productId === t.polo.p.id)!
    assert.equal(Number(polo.lineTotal), 200)
    assert.equal(polo.promotionName, '2x1 polos')
    // Precio efectivo por unidad: así una devolución reembolsa lo pagado.
    assert.approximately(Number(polo.unitPrice) * polo.quantity, 200, 0.02)
    assert.isNull(order.items.find((i) => i.productId === t.casaca.p.id)!.promotionName)
  })

  test('cupón válido aplica y queda registrado; uno inválido corta el pedido', async ({ assert }) => {
    const t = await montar()
    await t.promo({ name: 'Cupón 25', kind: 'percent', value: 25, code: 'VERANO25' })

    const { order } = await OrderService.crearDesdeTienda(
      t.business,
      datos(t, [{ variationId: t.polo.v.id, quantity: 2 }], { couponCode: 'verano25' })
    )
    assert.equal(Number(order.total), 150)
    assert.equal(order.couponCode, 'VERANO25')

    await assert.rejects(
      () => OrderService.crearDesdeTienda(t.business, datos(t, [{ variationId: t.polo.v.id, quantity: 1 }], { couponCode: 'FALSO' })),
      OrderError as any
    )
  })

  test('un cupón que no aplica a nada del carrito avisa en vez de ignorarse', async ({ assert }) => {
    const t = await montar()
    await t.promo({ name: 'Solo casacas', scope: 'product', productId: t.casaca.p.id, kind: 'percent', value: 10, code: 'CASACA10' })

    await assert.rejects(
      () => OrderService.crearDesdeTienda(t.business, datos(t, [{ variationId: t.polo.v.id, quantity: 1 }], { couponCode: 'CASACA10' })),
      OrderError as any
    )
    // Sin pedido a medias.
    assert.lengthOf(await Order.query().where('business_id', t.business.id), 0)
  })

  test('cambiar o borrar una promoción no toca los pedidos ya hechos', async ({ assert }) => {
    const t = await montar()
    const p = await t.promo({ name: '50%', kind: 'percent', value: 50 })

    const { order } = await OrderService.crearDesdeTienda(t.business, datos(t, [{ variationId: t.polo.v.id, quantity: 1 }]))
    assert.equal(Number(order.total), 50)

    p.value = 10
    await p.save()
    await p.delete()

    const item = await OrderItem.query().where('order_id', order.id).firstOrFail()
    assert.equal(Number(item.unitPrice), 50)
    assert.equal(Number(item.lineTotal), 50)
    assert.equal(Number((await Order.findOrFail(order.id)).total), 50)
  })
})

test.group('API de promociones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crea, valida, pausa y borra desde el panel', async ({ client, assert }) => {
    const t = await montar()
    const base = `/api/b/${t.business.uuid}/discounts`

    const ok = await client
      .post(base)
      .json({ name: 'Verano', kind: 'percent', value: 20, scope: 'category', category_id: t.verano.id, code: 'verano 20' })
      .loginAs(t.user)
    ok.assertStatus(200)
    assert.equal(ok.body().data.code, 'VERANO20')
    assert.equal(ok.body().data.label, '−20%')
    const id = ok.body().data.id

    const casos: [object, RegExp][] = [
      [{ name: 'x', kind: 'percent', value: 20, scope: 'all' }, /nombre/i],
      [{ name: 'Mala', kind: 'percent', value: 150, scope: 'all' }, /porcentaje/i],
      [{ name: 'Mala', kind: 'bundle', buy_qty: 2, pay_qty: 2, scope: 'all' }, /N debe ser mayor/i],
      [{ name: 'Mala', kind: 'fixed', value: 0, scope: 'all' }, /monto/i],
      [{ name: 'Mala', kind: 'percent', value: 10, scope: 'product' }, /producto/i],
      [{ name: 'Mala', kind: 'percent', value: 10, scope: 'all', start_date: '2026-12-10', end_date: '2026-12-01' }, /fecha/i],
      [{ name: 'Mala', kind: 'percent', value: 10, scope: 'all', code: 'a b!' }, /código/i],
    ]
    for (const [cuerpo, msg] of casos) {
      const r = await client.post(base).json(cuerpo).loginAs(t.user)
      r.assertStatus(422)
      assert.match(r.body().message, msg)
    }

    // El mismo código dos veces (sin importar mayúsculas) no se deja.
    const repetido = await client
      .post(base)
      .json({ name: 'Otra', kind: 'fixed', value: 5, scope: 'all', code: 'VERANO20' })
      .loginAs(t.user)
    repetido.assertStatus(422)

    const pausa = await client.put(`${base}/${id}/toggle`).json({ is_active: false }).loginAs(t.user)
    assert.isFalse(pausa.body().data.isActive)
    assert.lengthOf(await PromotionService.activas(t.business.id, 'VERANO20'), 0)

    ;(await client.delete(`${base}/${id}`).loginAs(t.user)).assertStatus(200)
    assert.lengthOf(await Discount.query().where('business_id', t.business.id), 0)
  })

  test('no se puede apuntar a un producto o categoría de otra tienda', async ({ client }) => {
    const t = await montar()
    const otra = await montar()

    const base = `/api/b/${t.business.uuid}/discounts`
    ;(
      await client
        .post(base)
        .json({ name: 'Intruso', kind: 'percent', value: 10, scope: 'product', product_id: otra.polo.p.id })
        .loginAs(t.user)
    ).assertStatus(422)
    ;(
      await client
        .post(base)
        .json({ name: 'Intruso', kind: 'percent', value: 10, scope: 'category', category_id: otra.verano.id })
        .loginAs(t.user)
    ).assertStatus(422)
  })

  test('la tienda pública muestra las automáticas, esconde los cupones y cotiza el carrito', async ({ client, assert }) => {
    const t = await montar()
    await t.promo({ name: 'Polo 2x1', scope: 'product', productId: t.polo.p.id, kind: 'bundle', buyQty: 2, payQty: 1 })
    await t.promo({ name: 'Cupón secreto', kind: 'percent', value: 30, code: 'SECRETO30' })

    const publicas = await client.get(`/api/store/${t.slug}/promotions`)
    publicas.assertStatus(200)
    assert.deepEqual(publicas.body().data.map((p: any) => p.name), ['Polo 2x1'])
    assert.equal(publicas.body().data[0].label, '2x1')

    const sin = await client.post(`/api/store/${t.slug}/quote`).json({ items: [{ variationId: t.polo.v.id, quantity: 2 }] })
    assert.equal(sin.body().data.descuento, 100)
    assert.isNull(sin.body().data.cupon)

    const con = await client
      .post(`/api/store/${t.slug}/quote`)
      .json({ items: [{ variationId: t.polo.v.id, quantity: 1 }, { variationId: t.casaca.v.id, quantity: 1 }], couponCode: 'secreto30' })
    // 2x1 no aplica con 1 polo; el cupón 30 % sí: 100×30% + 200×30% = 90.
    assert.equal(con.body().data.descuento, 90)
    assert.isTrue(con.body().data.cupon.valido)

    const mal = await client
      .post(`/api/store/${t.slug}/quote`)
      .json({ items: [{ variationId: t.polo.v.id, quantity: 1 }], couponCode: 'NOEXISTE' })
    assert.isFalse(mal.body().data.cupon.valido)
  })

  test('el catálogo público muestra el precio con promoción y sus etiquetas', async ({ client, assert }) => {
    const t = await montar()
    await t.promo({ name: 'Verano -20', scope: 'category', categoryId: t.verano.id, kind: 'percent', value: 20 })
    await t.promo({ name: 'Cupón', kind: 'percent', value: 50, code: 'MITAD' })

    const res = await client.get(`/api/store/${t.slug}/products`)
    const polo = res.body().data.find((p: any) => p.name === 'Polo')
    const casaca = res.body().data.find((p: any) => p.name === 'Casaca')

    assert.equal(polo.price, 80)
    assert.equal(polo.originalPrice, 100)
    assert.deepEqual(polo.promos.map((x: any) => x.label), ['−20%'])
    assert.equal(casaca.price, 200) // fuera de la categoría y el cupón no se muestra solo
    assert.lengthOf(casaca.promos, 0)
  })
})
