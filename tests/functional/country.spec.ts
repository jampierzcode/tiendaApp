import Business from '#models/business'
import Product from '#models/product'
import Role from '#models/role'
import User from '#models/user'
import { validarWhatsapp } from '#services/countries'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/** País del negocio: impuesto automático y WhatsApp del país. */

async function tienda(extra: object = {}) {
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
    name: 'Mi negocio',
    userId: user.id,
    status: 'activo',
    ...extra,
  } as any)
  return { user, business, base: `/api/b/${business.uuid}` }
}

test.group('País, impuesto y WhatsApp', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('validarWhatsapp acepta solo números del país', ({ assert }) => {
    assert.isNull(validarWhatsapp('PE', '51987654321'))
    assert.isNotNull(validarWhatsapp('PE', '5198765432')) // falta un dígito
    assert.isNotNull(validarWhatsapp('PE', '51887654321')) // celular no empieza con 9
    assert.isNotNull(validarWhatsapp('PE', '5215512345678')) // es de México
    assert.isNull(validarWhatsapp('MX', '525512345678'))
    assert.isNotNull(validarWhatsapp('MX', '51987654321'))
    assert.isNull(validarWhatsapp('CL', '56987654321'))
  })

  test('el impuesto sale del país: Perú 18, México 16, Chile 19', async ({ assert }) => {
    const t = await tienda()
    assert.equal(t.business.taxRate, 18)
    assert.equal(t.business.taxName, 'IGV')
    t.business.country = 'MX'
    assert.equal(t.business.taxRate, 16)
    assert.equal(t.business.taxName, 'IVA')
    t.business.country = 'CL'
    assert.equal(t.business.taxRate, 19)
  })

  test('un producto nuevo usa el impuesto del negocio aunque le manden otro', async ({ client, assert }) => {
    const t = await tienda({ country: 'CL' })
    const res = await client
      .post(`${t.base}/products`)
      .json({ name: 'Polera', price: 20, tax_rate: 5 })
      .loginAs(t.user)
    res.assertStatus(200)
    assert.equal(Number((await Product.findOrFail(res.body().data.id)).taxRate), 19)
  })

  test('cambiar de país actualiza el impuesto de todos los productos', async ({ client, assert }) => {
    const t = await tienda({ whatsappPhone: '51987654321' })
    const p = await client.post(`${t.base}/products`).json({ name: 'Polo', price: 30 }).loginAs(t.user)
    assert.equal(Number((await Product.findOrFail(p.body().data.id)).taxRate), 18)

    // Con el WhatsApp de Perú no se puede pasar a México.
    const mal = await client.put(`${t.base}/store-settings`).json({ country: 'MX' }).loginAs(t.user)
    mal.assertStatus(422)
    assert.equal((await Business.findOrFail(t.business.id)).country, 'PE')

    const ok = await client
      .put(`${t.base}/store-settings`)
      .json({ country: 'MX', whatsapp_phone: '525512345678' })
      .loginAs(t.user)
    ok.assertStatus(200)
    assert.equal((await Business.findOrFail(t.business.id)).country, 'MX')
    assert.equal(Number((await Product.findOrFail(p.body().data.id)).taxRate), 16)
  })

  test('el WhatsApp debe ser del país; un número ya guardado no bloquea otros cambios', async ({ client, assert }) => {
    const t = await tienda({ whatsappPhone: '51111111111' }) // guardado de antes, no cumple el formato
    const ok = await client
      .put(`${t.base}/store-settings`)
      .json({ name: 'Nuevo nombre', whatsapp_phone: '51111111111' })
      .loginAs(t.user)
    ok.assertStatus(200)

    const mal = await client.put(`${t.base}/store-settings`).json({ whatsapp_phone: '5212345' }).loginAs(t.user)
    mal.assertStatus(422)
    assert.match(mal.body().message, /Perú/)

    const bien = await client.put(`${t.base}/store-settings`).json({ whatsapp_phone: '51912345678' }).loginAs(t.user)
    bien.assertStatus(200)
  })

  test('un país que no existe se rechaza', async ({ client }) => {
    const t = await tienda()
    const res = await client.put(`${t.base}/store-settings`).json({ country: 'ZZ' }).loginAs(t.user)
    res.assertStatus(422)
  })
})
