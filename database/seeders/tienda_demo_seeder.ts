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
 * Dos tiendas de ropa de dueños distintos.
 *
 * Que sean dos dueños distintos no es decorativo: es lo que permite probar
 * que un admin no ve ni toca el catálogo del otro.
 */
export default class extends BaseSeeder {
  async run() {
    const adminRole = await Role.firstOrCreate({ name: 'admin' }, { name: 'admin' })

    const tiendas = [
      {
        owner: { name: 'Rosa Quispe', email: 'rosa@modaslima.pe' },
        business: {
          name: 'Modas Lima',
          description: 'Ropa urbana de Gamarra. Envíos a todo el Perú.',
          whatsappPhone: '51987654321',
          primaryColor: '#0F172A',
          secondaryColor: '#F97316',
          city: 'Lima',
          address: 'Jr. Gamarra 1234, La Victoria',
          schedule: 'Lun a Sáb 9:00 - 20:00',
          instagram: 'modaslima',
          shippingCost: 12,
          freeShippingFrom: 150,
        },
        categorias: [
          { name: 'Polos', subs: ['Manga corta', 'Oversize'] },
          { name: 'Pantalones', subs: ['Jean', 'Cargo'] },
        ],
        etiquetas: [
          { name: 'Nuevo', color: '#16A34A' },
          { name: 'Oferta', color: '#DC2626' },
        ],
        productos: [
          { name: 'Polo Básico Algodón', price: 39.9, cost: 18.0, cat: 0, sub: 0 },
          { name: 'Polo Oversize Negro', price: 49.9, cost: 22.5, cat: 0, sub: 1 },
          { name: 'Jean Slim Azul', price: 89.9, cost: 45.0, cat: 1, sub: 0 },
          { name: 'Pantalón Cargo Beige', price: 79.9, cost: 38.0, cat: 1, sub: 1 },
        ],
      },
      {
        owner: { name: 'Luis Ramos', email: 'luis@boutiqueandes.pe' },
        business: {
          name: 'Boutique Andes',
          description: 'Casacas y abrigos para el frío.',
          whatsappPhone: '51912345678',
          primaryColor: '#1E293B',
          secondaryColor: '#0EA5E9',
          city: 'Cusco',
          address: 'Av. El Sol 456',
          schedule: 'Lun a Vie 10:00 - 19:00',
          instagram: 'boutiqueandes',
          shippingCost: 15,
          freeShippingFrom: 200,
        },
        categorias: [{ name: 'Casacas', subs: ['Jean', 'Cuero'] }],
        etiquetas: [{ name: 'Invierno', color: '#2563EB' }],
        productos: [
          { name: 'Casaca Jean Clásica', price: 129.9, cost: 62.0, cat: 0, sub: 0 },
          { name: 'Casaca Cuero Sintético', price: 189.9, cost: 95.0, cat: 0, sub: 1 },
        ],
      },
    ]

    for (const tienda of tiendas) {
      const user = await User.firstOrCreate(
        { email: tienda.owner.email },
        {
          name: tienda.owner.name,
          email: tienda.owner.email,
          password: 'tienda123',
          rolId: adminRole.id,
          status: 'activo',
        }
      )

      const business = await Business.firstOrCreate(
        { name: tienda.business.name },
        {
          uuid: randomUUID(),
          slug: await SlugService.uniqueSlugGlobal('businesses', tienda.business.name),
          userId: user.id,
          status: 'activo',
          currency: 'PEN',
          currencySymbol: 'S/',
          // Publicada y con WhatsApp: así la tienda demo se puede abrir y
          // pedir de verdad desde el primer minuto.
          isPublic: true,
          ...tienda.business,
        }
      )

      // Atributos de ropa: talla y color, ambos filtrables en la tienda.
      const talla = await ProductAttribute.create({
        businessId: business.id,
        name: 'Talla',
        type: 'size',
        isRequired: true,
        isFilterable: true,
      })

      const color = await ProductAttribute.create({
        businessId: business.id,
        name: 'Color',
        type: 'color',
        isRequired: true,
        isFilterable: true,
      })

      const tallas = await ProductAttributeValue.createMany(
        ['S', 'M', 'L', 'XL'].map((value) => ({
          businessId: business.id,
          attributeId: talla.id,
          value,
        }))
      )

      const colores = await ProductAttributeValue.createMany(
        [
          { value: 'Negro', hexColor: '#111111' },
          { value: 'Blanco', hexColor: '#F5F5F5' },
          { value: 'Azul', hexColor: '#1D4ED8' },
        ].map((c) => ({
          businessId: business.id,
          attributeId: color.id,
          value: c.value,
          hexColor: c.hexColor,
        }))
      )

      const tags = await Tag.createMany(
        await Promise.all(
          tienda.etiquetas.map(async (t) => ({
            businessId: business.id,
            name: t.name,
            slug: await SlugService.uniqueFor('tags', business.id, t.name),
            color: t.color,
          }))
        )
      )

      const categorias = []
      for (const cat of tienda.categorias) {
        const categoria = await Category.create({
          businessId: business.id,
          name: cat.name,
          slug: await SlugService.uniqueFor('categories', business.id, cat.name),
        })

        const subs = []
        for (const subName of cat.subs) {
          subs.push(
            await Subcategory.create({
              businessId: business.id,
              categoryId: categoria.id,
              name: subName,
              slug: await SlugService.uniqueFor('subcategories', business.id, subName),
            })
          )
        }

        categorias.push({ categoria, subs })
      }

      for (const [index, item] of tienda.productos.entries()) {
        const product = await Product.create({
          businessId: business.id,
          name: item.name,
          slug: await SlugService.uniqueFor('products', business.id, item.name),
          sku: `${business.id}-SKU-${1000 + index}`,
          description: `${item.name}. Envíos a todo el Perú.`,
          price: item.price,
          cost: item.cost,
          taxRate: 18,
          lowStockThreshold: 5,
          stock: 0,
          status: 'activo',
        })

        await product.related('tags').attach({
          [tags[index % tags.length].id]: { business_id: business.id },
        })

        const grupo = categorias[item.cat]
        await CategoryProduct.create({
          businessId: business.id,
          productId: product.id,
          categoryId: grupo.categoria.id,
          subcategoryId: grupo.subs[item.sub]?.id ?? null,
        })

        // Una variación por talla y color, con stock inicial vía kardex.
        for (const t of tallas.slice(0, 3)) {
          for (const c of colores.slice(0, 2)) {
            const variation = await ProductVariation.create({
              businessId: business.id,
              productId: product.id,
              sku: `${product.sku}-${t.value}-${c.value.slice(0, 3).toUpperCase()}`,
              isDefault: false,
              price: item.price,
              stock: 0,
            })

            await ProductVariationAttribute.createMany([
              { businessId: business.id, variationId: variation.id, attributeValueId: t.id },
              { businessId: business.id, variationId: variation.id, attributeValueId: c.id },
            ])

            await InventoryService.applyMovement({
              businessId: business.id,
              variationId: variation.id,
              type: 'inicial',
              quantity: 4 + ((index + t.id + c.id) % 12),
              unitCost: item.cost,
              note: 'Carga inicial de inventario',
              userId: user.id,
            })
          }
        }
      }

      console.log(`  ✓ ${business.name} — uuid ${business.uuid} — dueño ${user.email}`)
    }
  }
}
