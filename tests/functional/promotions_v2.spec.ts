import Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Discount from '#models/discount'
import DiscountTarget from '#models/discount_target'
import Product from '#models/product'
import ProductAttribute from '#models/product_attribute'
import ProductAttributeValue from '#models/product_attribute_value'
import ProductVariation from '#models/product_variation'
import ProductVariationAttribute from '#models/product_variation_attribute'
import Role from '#models/role'
import User from '#models/user'
import OrderService from '#services/order_service'
import PromotionService from '#services/promotion_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

/**
 * Promociones v2 (varios destinos, variaciones, días de la semana) y el
 * cambio de precio base de un producto con variaciones.
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

  const cat = await Category.create({ businessId: business.id, name: 'Verano', slug: 'verano' })
  const talla = await ProductAttribute.create({ businessId: business.id, name: 'Talla', type: 'text' } as any)
  const S = await ProductAttributeValue.create({ businessId: business.id, attributeId: talla.id, value: 'S' } as any)
  const M = await ProductAttributeValue.create({ businessId: business.id, attributeId: talla.id, value: 'M' } as any)

  async function producto(nombre: string, precio: number, conTallas = false) {
    const p = await Product.create({
      businessId: business.id,
      name: nombre,
      slug: `${nombre.toLowerCase()}-${randomUUID().slice(0, 4)}`,
      price: precio,
      taxRate: 18,
      lowStockThreshold: 1,
      stock: 0,
      status: 'activo',
    })
    await CategoryProduct.create({ businessId: business.id, productId: p.id, categoryId: cat.id })
    if (!conTallas) {
      const v = await ProductVariation.create({ businessId: business.id, productId: p.id, isDefault: true, price: precio, stock: 20 })
      return { p, v, vs: [v] }
    }
    const vs: ProductVariation[] = []
    for (const valor of [S, M]) {
      const v = await ProductVariation.create({ businessId: business.id, productId: p.id, isDefault: false, price: precio, stock: 20, sku: `${nombre}-${valor.value}` })
      await ProductVariationAttribute.create({ businessId: business.id, variationId: v.id, attributeValueId: valor.id } as any)
      vs.push(v)
    }
    return { p, v: vs[0], vs }
  }

  const polo = await producto('Polo', 100)
  const short = await producto('Short', 60)
  const casaca = await producto('Casaca', 200, true)

  const promo = async (datos: Record<string, unknown>, destinos: { kind: string; id: number }[] = []) => {
    const d = await Discount.create({
      businessId: business.id,
      name: 'Promo',
      kind: 'percent',
      value: 10,
      scope: destinos.length ? 'selection' : 'all',
      isActive: true,
      ...datos,
    } as any)
    for (const t of destinos) {
      await DiscountTarget.create({ businessId: business.id, discountId: d.id, kind: t.kind, targetId: t.id } as any)
    }
    await d.load('targets')
    return d
  }

  return { user, business, slug, cat, polo, short, casaca, S, M, promo, base: `/api/b/${business.uuid}` }
}

test.group('Promociones: varios destinos y variaciones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('una promoción puede apuntar a varios productos a la vez', async ({ assert }) => {
    const t = await montar()
    const p = await t.promo({ value: 20 }, [
      { kind: 'product', id: t.polo.p.id },
      { kind: 'product', id: t.short.p.id },
    ])

    assert.isTrue(PromotionService.aplicaA(p, t.polo.p.id, [t.cat.id]))
    assert.isTrue(PromotionService.aplicaA(p, t.short.p.id, [t.cat.id]))
    assert.isFalse(PromotionService.aplicaA(p, t.casaca.p.id, [t.cat.id]))
  })

  test('mezcla categorías, productos y variaciones en una misma promoción', async ({ assert }) => {
    const t = await montar()
    const [s, m] = t.casaca.vs
    const p = await t.promo({}, [
      { kind: 'category', id: 999 },
      { kind: 'variation', id: s.id },
    ])

    // Solo la talla S de la casaca; la M no.
    assert.isTrue(PromotionService.aplicaA(p, t.casaca.p.id, [], s.id))
    assert.isFalse(PromotionService.aplicaA(p, t.casaca.p.id, [], m.id))
    // Sin variación (vista de producto) no aplica a una promo de variación.
    assert.isFalse(PromotionService.aplicaA(p, t.casaca.p.id, []))
    // Y por categoría.
    assert.isTrue(PromotionService.aplicaA(p, t.polo.p.id, [999]))
  })

  test('el pedido aplica la promo de una variación solo a esa variación', async ({ assert }) => {
    const t = await montar()
    const [s, m] = t.casaca.vs
    await t.promo({ name: 'Talla S', kind: 'percent', value: 50 }, [{ kind: 'variation', id: s.id }])

    const { order } = await OrderService.crearDesdeTienda(t.business, {
      customerName: 'Ana',
      customerPhone: '987654321',
      deliveryMethod: 'recojo',
      items: [{ variationId: s.id, quantity: 1 }, { variationId: m.id, quantity: 1 }],
    })

    assert.equal(Number(order.discountTotal), 100) // 50 % de la S (200)
    assert.equal(Number(order.total), 300)
  })

  test('el catálogo marca «Desde» cuando una variación cuesta menos por promoción', async ({ client, assert }) => {
    const t = await montar()
    const [s] = t.casaca.vs
    await t.promo({ name: 'S barata', kind: 'percent', value: 25 }, [{ kind: 'variation', id: s.id }])

    const res = await client.get(`/api/store/${t.slug}/products`)
    const casaca = res.body().data.find((p: any) => p.name === 'Casaca')
    assert.equal(casaca.price, 150)
    assert.isTrue(casaca.desde)
    assert.deepEqual(casaca.promos.map((x: any) => x.label), ['−25%'])

    const polo = res.body().data.find((p: any) => p.name === 'Polo')
    assert.isFalse(polo.desde)
  })
})

test.group('Promociones: días de la semana', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // 2026-10-16 es viernes, 2026-10-17 sábado, 2026-10-19 lunes.
  const viernes = DateTime.fromISO('2026-10-16T12:00:00', { zone: 'America/Lima' })
  const sabado = DateTime.fromISO('2026-10-17T12:00:00', { zone: 'America/Lima' })
  const lunes = DateTime.fromISO('2026-10-19T12:00:00', { zone: 'America/Lima' })

  test('solo corre los días elegidos', async ({ assert }) => {
    const t = await montar()
    const bf = await t.promo({ weekdays: '5,6' })

    assert.isTrue(PromotionService.vigente(bf, viernes))
    assert.isTrue(PromotionService.vigente(bf, sabado))
    assert.isFalse(PromotionService.vigente(bf, lunes))
  })

  test('los días se combinan con el rango de fechas («los viernes de este mes»)', async ({ assert }) => {
    const t = await montar()
    const p = await t.promo({
      weekdays: '5',
      startDate: DateTime.fromISO('2026-10-01'),
      endDate: DateTime.fromISO('2026-10-31'),
    })

    assert.isTrue(PromotionService.vigente(p, viernes))
    assert.isFalse(PromotionService.vigente(p, sabado)) // no es viernes
    // Un viernes fuera del rango.
    assert.isFalse(PromotionService.vigente(p, DateTime.fromISO('2026-11-06T12:00:00', { zone: 'America/Lima' })))
  })

  test('sin días corre todos; una pausada nunca', async ({ assert }) => {
    const t = await montar()
    assert.isTrue(PromotionService.vigente(await t.promo({}), lunes))
    assert.isFalse(PromotionService.vigente(await t.promo({ isActive: false }), lunes))
  })

  test('el día se mide con la hora del país, no la del servidor', async ({ assert }) => {
    const t = await montar()
    const bf = await t.promo({ weekdays: '5' })
    // Viernes 23:30 en Lima ya es sábado en UTC.
    const tarde = DateTime.fromISO('2026-10-16T23:30:00', { zone: 'America/Lima' })
    assert.isTrue(PromotionService.vigente(bf, tarde))
    assert.isFalse(PromotionService.vigente(bf, tarde.setZone('UTC')))
  })

  test('el texto de los días es legible', async ({ assert }) => {
    const t = await montar()
    assert.equal(PromotionService.diasTexto(await t.promo({ weekdays: '5,6' })), 'viernes y sábado')
    assert.equal(PromotionService.diasTexto(await t.promo({ weekdays: '1,3,5' })), 'lunes, miércoles y viernes')
    assert.isNull(PromotionService.diasTexto(await t.promo({})))
    assert.isNull(PromotionService.diasTexto(await t.promo({ weekdays: '1,2,3,4,5,6,7' })))
  })
})

test.group('API de promociones v2', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crea una promoción con varios destinos y días, y los devuelve con nombre', async ({ client, assert }) => {
    const t = await montar()
    const [s] = t.casaca.vs

    const res = await client
      .post(`${t.base}/discounts`)
      .json({
        name: 'Black Friday',
        kind: 'percent',
        value: 30,
        scope: 'selection',
        weekdays: [5, 6],
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        targets: [
          { kind: 'product', id: t.polo.p.id },
          { kind: 'variation', id: s.id },
          { kind: 'category', id: t.cat.id },
        ],
      })
      .loginAs(t.user)

    res.assertStatus(200)
    assert.equal(res.body().data.diasTexto, 'viernes y sábado')
    assert.lengthOf(res.body().data.targets, 3)

    const lista = await client.get(`${t.base}/discounts`).loginAs(t.user)
    const bf = lista.body().data[0]
    assert.deepEqual(
      bf.targets.map((x: any) => x.name).sort(),
      ['Casaca — S', 'Polo', 'Verano']
    )
    assert.deepEqual(bf.weekdays, [5, 6])
  })

  test('editar reemplaza los destinos; una selección vacía o ajena se rechaza', async ({ client, assert }) => {
    const t = await montar()
    const otra = await montar()

    const creada = await client
      .post(`${t.base}/discounts`)
      .json({ name: 'Verano', kind: 'percent', value: 10, scope: 'selection', targets: [{ kind: 'product', id: t.polo.p.id }] })
      .loginAs(t.user)
    const id = creada.body().data.id

    const edit = await client
      .put(`${t.base}/discounts/${id}`)
      .json({ name: 'Verano', kind: 'percent', value: 10, scope: 'selection', targets: [{ kind: 'product', id: t.short.p.id }] })
      .loginAs(t.user)
    edit.assertStatus(200)
    assert.deepEqual((await DiscountTarget.query().where('discount_id', id)).map((x) => x.targetId), [t.short.p.id])

    ;(await client.put(`${t.base}/discounts/${id}`).json({ name: 'Verano', kind: 'percent', value: 10, scope: 'selection', targets: [] }).loginAs(t.user)).assertStatus(422)
    ;(
      await client
        .put(`${t.base}/discounts/${id}`)
        .json({ name: 'Verano', kind: 'percent', value: 10, scope: 'selection', targets: [{ kind: 'product', id: otra.polo.p.id }] })
        .loginAs(t.user)
    ).assertStatus(422)
    ;(
      await client
        .post(`${t.base}/discounts`)
        .json({ name: 'Mal día', kind: 'percent', value: 10, scope: 'all', weekdays: [8] })
        .loginAs(t.user)
    ).assertStatus(422)

    // Lo ajeno no se guardó.
    assert.deepEqual((await DiscountTarget.query().where('discount_id', id)).map((x) => x.targetId), [t.short.p.id])
  })

  test('la tienda pública explica a qué aplica y qué días', async ({ client, assert }) => {
    const t = await montar()
    await t.promo({ name: 'Viernes loco', value: 15, weekdays: '1,2,3,4,5,6,7' }, [
      { kind: 'product', id: t.polo.p.id },
      { kind: 'product', id: t.short.p.id },
      { kind: 'category', id: t.cat.id },
    ])
    await t.promo({ name: 'Solo polo', value: 5 }, [{ kind: 'product', id: t.polo.p.id }])

    const res = await client.get(`/api/store/${t.slug}/promotions`)
    const vl = res.body().data.find((p: any) => p.name === 'Viernes loco')
    assert.match(vl.alcance, /y 1 más/)
    assert.isNull(vl.product)

    const solo = res.body().data.find((p: any) => p.name === 'Solo polo')
    assert.equal(solo.product.name, 'Polo')
    assert.equal(solo.alcance, 'Polo')
  })
})

test.group('Cambiar el precio base con variaciones', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const precios = async (productId: number) =>
    (await ProductVariation.query().where('product_id', productId).orderBy('id', 'asc')).map((v) => Number(v.price))

  test('si todas usan el precio base, cambian solas', async ({ client, assert }) => {
    const t = await montar()
    const res = await client.put(`${t.base}/products/${t.casaca.p.id}`).json({ price: 180 }).loginAs(t.user)
    res.assertStatus(200)
    assert.deepEqual(await precios(t.casaca.p.id), [180, 180])
    assert.equal(Number((await Product.findOrFail(t.casaca.p.id)).price), 180)
  })

  test('si alguna tiene precio propio, pregunta antes de tocar nada', async ({ client, assert }) => {
    const t = await montar()
    const [s] = t.casaca.vs
    s.price = 150
    await s.save()

    const res = await client.put(`${t.base}/products/${t.casaca.p.id}`).json({ price: 180 }).loginAs(t.user)
    res.assertStatus(409)
    assert.equal(res.body().code, 'price_decision')
    assert.equal(res.body().data.variaciones.length, 1)
    assert.equal(res.body().data.variaciones[0].precio, 150)
    assert.equal(res.body().data.variaciones[0].label, 'S')

    // No se guardó nada.
    assert.equal(Number((await Product.findOrFail(t.casaca.p.id)).price), 200)
    assert.deepEqual(await precios(t.casaca.p.id), [150, 200])
  })

  test('«solo las del precio base» respeta las que tenían precio propio', async ({ client, assert }) => {
    const t = await montar()
    const [s] = t.casaca.vs
    s.price = 150
    await s.save()

    ;(await client.put(`${t.base}/products/${t.casaca.p.id}`).json({ price: 180, price_mode: 'base_only' }).loginAs(t.user)).assertStatus(200)
    assert.deepEqual(await precios(t.casaca.p.id), [150, 180])
    assert.equal(Number((await Product.findOrFail(t.casaca.p.id)).price), 180)
  })

  test('«todas» sobrescribe también las de precio propio', async ({ client, assert }) => {
    const t = await montar()
    const [s] = t.casaca.vs
    s.price = 150
    await s.save()

    ;(await client.put(`${t.base}/products/${t.casaca.p.id}`).json({ price: 180, price_mode: 'all' }).loginAs(t.user)).assertStatus(200)
    assert.deepEqual(await precios(t.casaca.p.id), [180, 180])
  })

  test('editar otra cosa sin cambiar el precio no pregunta nada', async ({ client }) => {
    const t = await montar()
    const [s] = t.casaca.vs
    s.price = 150
    await s.save()

    ;(await client.put(`${t.base}/products/${t.casaca.p.id}`).json({ name: 'Casaca nueva', price: 200 }).loginAs(t.user)).assertStatus(200)
  })

  test('un producto simple sigue cambiando su precio sin preguntas', async ({ client, assert }) => {
    const t = await montar()
    ;(await client.put(`${t.base}/products/${t.polo.p.id}`).json({ price: 90 }).loginAs(t.user)).assertStatus(200)
    assert.deepEqual(await precios(t.polo.p.id), [90])
  })
})
