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
import Tag from '#models/tag'
import User from '#models/user'
import InventoryService from '#services/inventory_service'
import SlugService from '#services/slug_service'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { randomUUID } from 'node:crypto'

/**
 * VISULL BOUTIQUE, con su propio usuario administrador.
 *
 * El catálogo que carga aquí es de arranque: sirve para ver la tienda
 * funcionando y se borra desde el panel cuando entren los productos reales.
 *
 *   node ace db:seed --files="database/seeders/visull_boutique_seeder.ts"
 */
export default class extends BaseSeeder {
  async run() {
    const rolAdmin = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })

    const user = await User.firstOrCreate(
      { email: 'admin@visullboutique.com' },
      {
        name: 'Administrador VISULL BOUTIQUE',
        email: 'admin@visullboutique.com',
        password: 'visull123',
        rolId: rolAdmin.id,
        status: 'activo',
      }
    )

    const business = await Business.firstOrCreate(
      { name: 'VISULL BOUTIQUE' },
      {
        uuid: randomUUID(),
        slug: 'visull-boutique',
        name: 'VISULL BOUTIQUE',
        description: 'Moda femenina con estilo. Envíos a todo el Perú.',
        userId: user.id,
        status: 'activo',

        // OJO: número de ejemplo. Cámbialo en el panel, en
        // Configuración de la tienda, antes de dar el link a nadie.
        whatsappPhone: '51900000000',

        primaryColor: '#1C1917',
        secondaryColor: '#C9A227',
        currency: 'PEN',
        currencySymbol: 'S/',
        city: 'Lima',
        schedule: 'Lun a Sáb 10:00 - 20:00',
        instagram: 'visullboutique',
        shippingCost: 12,
        freeShippingFrom: 199,
        isPublic: true,
      }
    )

    // Si el seeder ya corrió antes, no se duplica el catálogo.
    const yaTieneCatalogo = await Product.query().where('business_id', business.id).first()
    if (yaTieneCatalogo) {
      console.log(`  · VISULL BOUTIQUE ya existía (slug ${business.slug}), no se tocó el catálogo`)
      return
    }

    const attrTalla = await ProductAttribute.create({
      businessId: business.id,
      name: 'Talla',
      type: 'size',
      isRequired: true,
      isFilterable: true,
    })

    const attrColor = await ProductAttribute.create({
      businessId: business.id,
      name: 'Color',
      type: 'color',
      isRequired: true,
      isFilterable: true,
    })

    const tallas = await ProductAttributeValue.createMany(
      ['XS', 'S', 'M', 'L', 'XL'].map((value) => ({
        businessId: business.id,
        attributeId: attrTalla.id,
        value,
      }))
    )

    const colores = await ProductAttributeValue.createMany(
      [
        { value: 'Negro', hexColor: '#111111' },
        { value: 'Beige', hexColor: '#D8C3A5' },
        { value: 'Vino', hexColor: '#7B1E3A' },
        { value: 'Blanco', hexColor: '#F7F7F5' },
      ].map((c) => ({
        businessId: business.id,
        attributeId: attrColor.id,
        value: c.value,
        hexColor: c.hexColor,
      }))
    )

    const etiquetas = await Tag.createMany([
      { businessId: business.id, name: 'Nuevo', slug: 'nuevo', color: '#166534' },
      { businessId: business.id, name: 'Más vendido', slug: 'mas-vendido', color: '#C9A227' },
      { businessId: business.id, name: 'Oferta', slug: 'oferta', color: '#B91C1C' },
    ])

    const estructura = [
      { name: 'Vestidos', subs: ['Casual', 'Fiesta'] },
      { name: 'Blusas', subs: ['Manga larga', 'Sin manga'] },
      { name: 'Pantalones', subs: ['Jean', 'Palazzo'] },
      { name: 'Casacas', subs: ['Ligeras', 'Abrigos'] },
    ]

    const categorias = []
    for (const grupo of estructura) {
      const categoria = await Category.create({
        businessId: business.id,
        name: grupo.name,
        slug: await SlugService.uniqueFor('categories', business.id, grupo.name),
      })

      const subs = []
      for (const nombre of grupo.subs) {
        subs.push(
          await Subcategory.create({
            businessId: business.id,
            categoryId: categoria.id,
            name: nombre,
            slug: await SlugService.uniqueFor('subcategories', business.id, nombre),
          })
        )
      }
      categorias.push({ categoria, subs })
    }

    const catalogo = [
      { name: 'Vestido Midi Satinado', price: 149.9, cost: 68, cat: 0, sub: 1, tag: 0 },
      { name: 'Vestido Casual Lino', price: 119.9, cost: 52, cat: 0, sub: 0, tag: 1 },
      { name: 'Blusa Seda Manga Larga', price: 89.9, cost: 38, cat: 1, sub: 0, tag: 0 },
      { name: 'Blusa Halter Elegante', price: 79.9, cost: 33, cat: 1, sub: 1, tag: 2 },
      { name: 'Jean Mom Tiro Alto', price: 109.9, cost: 48, cat: 2, sub: 0, tag: 1 },
      { name: 'Pantalón Palazzo Fluido', price: 99.9, cost: 42, cat: 2, sub: 1, tag: 0 },
      { name: 'Casaca Corta Gamuza', price: 179.9, cost: 82, cat: 3, sub: 0, tag: 1 },
      { name: 'Abrigo Largo Paño', price: 249.9, cost: 118, cat: 3, sub: 1, tag: 2 },
    ]

    for (const [indice, item] of catalogo.entries()) {
      const product = await Product.create({
        businessId: business.id,
        name: item.name,
        slug: await SlugService.uniqueFor('products', business.id, item.name),
        sku: `VB-${String(1000 + indice)}`,
        description: `${item.name}. Prenda de VISULL BOUTIQUE, envíos a todo el Perú.`,
        price: item.price,
        cost: item.cost,
        taxRate: 18,
        lowStockThreshold: 3,
        stock: 0,
        status: 'activo',
      })

      await product.related('tags').attach({
        [etiquetas[item.tag].id]: { business_id: business.id },
      })

      const grupo = categorias[item.cat]
      await CategoryProduct.create({
        businessId: business.id,
        productId: product.id,
        categoryId: grupo.categoria.id,
        subcategoryId: grupo.subs[item.sub]?.id ?? null,
      })

      // Tallas S/M/L en dos colores, con stock inicial pasando por el kardex.
      for (const talla of tallas.slice(1, 4)) {
        for (const color of colores.slice(0, 2)) {
          const variation = await ProductVariation.create({
            businessId: business.id,
            productId: product.id,
            sku: `${product.sku}-${talla.value}-${color.value.slice(0, 3).toUpperCase()}`,
            isDefault: false,
            price: item.price,
            stock: 0,
            priceModifier: 0,
          })

          await ProductVariationAttribute.createMany([
            { businessId: business.id, variationId: variation.id, attributeValueId: talla.id },
            { businessId: business.id, variationId: variation.id, attributeValueId: color.id },
          ])

          await InventoryService.applyMovement({
            businessId: business.id,
            variationId: variation.id,
            type: 'inicial',
            quantity: 3 + ((indice + talla.id + color.id) % 9),
            unitCost: item.cost,
            note: 'Carga inicial de inventario',
            userId: user.id,
          })
        }
      }
    }

    console.log(`  ✓ VISULL BOUTIQUE creada`)
    console.log(`    panel:  /b/${business.uuid}/products`)
    console.log(`    tienda: /t/${business.slug}`)
    console.log(`    acceso: admin@visullboutique.com / visull123`)
    console.log(`    ⚠ cambia el WhatsApp (${business.whatsappPhone}) antes de compartir el link`)
  }
}
