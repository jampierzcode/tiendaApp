import Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Product from '#models/product'
import ProductAttribute from '#models/product_attribute'
import ProductAttributeValue from '#models/product_attribute_value'
import ProductVariation from '#models/product_variation'
import ProductVariationAttribute from '#models/product_variation_attribute'
import Role from '#models/role'
import Subcategory from '#models/subcategory'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'

/**
 * Catálogo público: facetas con conteos, búsqueda por SKU/descripción y
 * productos relacionados.
 */

async function montar() {
  const rol = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })
  const user = await User.create({
    name: `Dueño ${randomUUID()}`,
    email: `${randomUUID()}@test.pe`,
    password: 'secreto123',
    rolId: rol.id,
    status: 'activo',
  })
  const slug = `tienda-${randomUUID().slice(0, 8)}`
  const business = await Business.create({
    uuid: randomUUID(),
    name: 'Repuestos',
    slug,
    userId: user.id,
    status: 'activo',
    isPublic: true,
  } as any)

  const motor = await Category.create({ businessId: business.id, name: 'Motor', slug: 'motor' })
  const bobinas = await Subcategory.create({ businessId: business.id, categoryId: motor.id, name: 'Bobinas', slug: 'bobinas' })
  const cables = await Subcategory.create({ businessId: business.id, categoryId: motor.id, name: 'Cables', slug: 'cables' })
  const frenos = await Category.create({ businessId: business.id, name: 'Frenos', slug: 'frenos' })

  const marca = await ProductAttribute.create({ businessId: business.id, name: 'Marca', type: 'select', isRequired: false, isFilterable: true } as any)
  const aktion = await ProductAttributeValue.create({ businessId: business.id, attributeId: marca.id, value: 'AKTION' } as any)
  const donen = await ProductAttributeValue.create({ businessId: business.id, attributeId: marca.id, value: 'DONEN' } as any)

  async function producto(nombre: string, sku: string, cat: Category, sub: Subcategory | null, desc: string, valores: ProductAttributeValue[]) {
    const p = await Product.create({
      businessId: business.id, name: nombre, slug: nombre.toLowerCase().replace(/\W+/g, '-'),
      sku, description: desc, price: 10, taxRate: 18, lowStockThreshold: 5, stock: 0, status: 'activo',
    })
    await CategoryProduct.create({ businessId: business.id, productId: p.id, categoryId: cat.id, subcategoryId: sub?.id ?? null })
    for (const [i, val] of (valores.length ? valores : [null]).entries()) {
      const v = await ProductVariation.create({ businessId: business.id, productId: p.id, sku: `${sku}-${i}`, isDefault: i === 0, price: 10, stock: 5 })
      if (val) await ProductVariationAttribute.create({ businessId: business.id, variationId: v.id, attributeValueId: val.id } as any)
    }
    return p
  }

  const b1 = await producto('Bobina Accent', 'IH-1', motor, bobinas, 'Referencia OEM: 27301-03200', [aktion, donen])
  const b2 = await producto('Bobina Rio', 'IH-2', motor, bobinas, 'Kia Rio', [aktion])
  const c1 = await producto('Cable Toyota', 'IH-3', motor, cables, 'Toyota Tercel', [donen])
  const f1 = await producto('Pastilla', 'FR-1', frenos, null, 'Frenos delanteros', [])
  return { slug, motor, bobinas, cables, frenos, marca, aktion, donen, b1, b2, c1, f1 }
}

test.group('Tienda pública: catálogo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('busca por SKU y por la referencia OEM de la descripción', async ({ client, assert }) => {
    const t = await montar()
    const porSku = await client.get(`/api/store/${t.slug}/products?search=IH-3`)
    assert.deepEqual(porSku.body().data.map((p: any) => p.name), ['Cable Toyota'])

    const porOem = await client.get(`/api/store/${t.slug}/products?search=27301-03200`)
    assert.deepEqual(porOem.body().data.map((p: any) => p.name), ['Bobina Accent'])

    const dosPalabras = await client.get(`/api/store/${t.slug}/products?search=bobina rio`)
    assert.deepEqual(dosPalabras.body().data.map((p: any) => p.name), ['Bobina Rio'])
  })

  test('las facetas cuentan productos y esconden lo que quedaría en cero', async ({ client, assert }) => {
    const t = await montar()
    const todo = (await client.get(`/api/store/${t.slug}/facets`)).body().data
    const motor = todo.categories.find((c: any) => c.slug === 'motor')
    assert.equal(motor.count, 3)
    assert.equal(motor.subcategories.find((s: any) => s.slug === 'bobinas').count, 2)
    const aktion = todo.attributes[0].values.find((v: any) => v.value === 'AKTION')
    assert.equal(aktion.count, 2)

    // Dentro de Cables solo existe DONEN: AKTION desaparece de la lista.
    const cables = (await client.get(`/api/store/${t.slug}/facets?category=motor&subcategory=cables`)).body().data
    assert.deepEqual(cables.attributes[0].values.map((v: any) => v.value), ['DONEN'])
  })

  test('filtrar por marca devuelve solo los productos que la tienen', async ({ client, assert }) => {
    const t = await montar()
    const res = await client.get(`/api/store/${t.slug}/products?attributeValues=${t.aktion.id}`)
    assert.sameMembers(res.body().data.map((p: any) => p.name), ['Bobina Accent', 'Bobina Rio'])
  })

  test('los relacionados salen primero de la misma subcategoría y nunca incluyen al propio', async ({ client, assert }) => {
    const t = await montar()
    const res = await client.get(`/api/store/${t.slug}/products/${t.b1.slug}/related`)
    const nombres = res.body().data.map((p: any) => p.name)
    assert.equal(nombres[0], 'Bobina Rio')
    assert.notInclude(nombres, 'Bobina Accent')
    assert.include(nombres, 'Cable Toyota')
    assert.notInclude(nombres, 'Pastilla')
  })
})
