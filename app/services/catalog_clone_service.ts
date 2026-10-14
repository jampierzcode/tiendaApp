import Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import Ingredient from '#models/ingredient'
import ModifierGroup from '#models/modifier_group'
import ModifierOption from '#models/modifier_option'
import Product from '#models/product'
import ProductModifierGroup from '#models/product_modifier_group'
import ProductVariation from '#models/product_variation'
import Recipe from '#models/recipe'
import RecipeLine from '#models/recipe_line'
import Subcategory from '#models/subcategory'
import SlugService from '#services/slug_service'
import db from '@adonisjs/lucid/services/db'

export type CloneSummary = {
  categories: number
  subcategories: number
  products: number
  ingredients: number
  recipes: number
  modifierGroups: number
}

/**
 * Copia el catálogo de un negocio (el "molde") a otro nuevo: categorías,
 * productos, insumos, recetas y modificadores. Sirve para dejar un restaurante
 * listo para entregar en minutos.
 *
 * Qué NO copia, a propósito:
 *  - Imágenes: cada negocio es dueño de las suyas y borrar una en la galería
 *    borra el objeto del bucket; compartirlas rompería al otro negocio.
 *  - Stock de insumos (arranca en 0) ni movimientos, pedidos o clientes.
 *  - Etiquetas, descuentos ni proveedores.
 *
 * Solo se permite sobre un negocio destino vacío, para no mezclar ni duplicar.
 */
export default class CatalogCloneService {
  static async clone(source: Business, target: Business): Promise<CloneSummary> {
    if (source.id === target.id) throw new Error('El origen y el destino son el mismo negocio')

    const ocupado = await db
      .from('products')
      .where('business_id', target.id)
      .count('* as n')
      .first()
    const ocupadoIng = await db
      .from('ingredients')
      .where('business_id', target.id)
      .count('* as n')
      .first()
    if (Number(ocupado?.n ?? 0) > 0 || Number(ocupadoIng?.n ?? 0) > 0) {
      throw new Error('El negocio destino ya tiene productos o insumos; cópialo solo en uno vacío')
    }

    return db.transaction(async (trx) => {
      const opts = { client: trx }
      const q = <T extends { query: (o?: any) => any }>(m: T) => m.query(opts)

      // --- Tipo de negocio: un molde de restaurante hace restaurante ---
      if (target.businessType !== source.businessType) {
        target.useTransaction(trx)
        target.businessType = source.businessType
        await target.save()
      }

      // --- Categorías y subcategorías ---
      const catMap = new Map<number, number>()
      const subMap = new Map<number, number>()
      const cats = await q(Category).where('business_id', source.id).orderBy('sort_order').orderBy('id')
      for (const c of cats) {
        const nueva = await Category.create(
          {
            businessId: target.id,
            name: c.name,
            slug: await SlugService.uniqueFor('categories', target.id, c.name),
            description: c.description,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
          },
          opts
        )
        catMap.set(c.id, nueva.id)
      }
      const subs = await q(Subcategory).where('business_id', source.id).orderBy('sort_order').orderBy('id')
      for (const s of subs) {
        const categoryId = catMap.get(s.categoryId)
        if (!categoryId) continue
        const nueva = await Subcategory.create(
          {
            businessId: target.id,
            categoryId,
            name: s.name,
            slug: await SlugService.uniqueFor('subcategories', target.id, s.name),
            description: s.description,
            sortOrder: s.sortOrder,
          },
          opts
        )
        subMap.set(s.id, nueva.id)
      }

      // --- Insumos (sin stock) ---
      const ingMap = new Map<number, number>()
      const ings = await q(Ingredient).where('business_id', source.id).orderBy('id')
      for (const i of ings) {
        const nueva = await Ingredient.create(
          {
            businessId: target.id,
            name: i.name,
            unit: i.unit,
            stock: 0,
            minStock: i.minStock,
            avgCost: i.avgCost,
            isActive: i.isActive,
          },
          opts
        )
        ingMap.set(i.id, nueva.id)
      }

      // --- Grupos de modificadores y sus opciones ---
      const groupMap = new Map<number, number>()
      const groups = await q(ModifierGroup)
        .where('business_id', source.id)
        .preload('options', (o: any) => o.orderBy('sort_order').orderBy('id'))
        .orderBy('id')
      for (const g of groups) {
        const nuevo = await ModifierGroup.create(
          {
            businessId: target.id,
            name: g.name,
            description: g.description,
            isActive: g.isActive,
          },
          opts
        )
        groupMap.set(g.id, nuevo.id)
        for (const o of g.options) {
          await ModifierOption.create(
            {
              businessId: target.id,
              modifierGroupId: nuevo.id,
              name: o.name,
              priceDelta: o.priceDelta,
              isActive: o.isActive,
              sortOrder: o.sortOrder,
              ingredientId: o.ingredientId ? (ingMap.get(o.ingredientId) ?? null) : null,
              ingredientQty: o.ingredientQty,
            },
            opts
          )
        }
      }

      // --- Productos con su variación por defecto, categorías, receta y grupos ---
      const prodMap = new Map<number, number>()
      const productos = await q(Product).where('business_id', source.id).orderBy('id')
      let recipes = 0
      for (const p of productos) {
        const nuevo = await Product.create(
          {
            businessId: target.id,
            name: p.name,
            slug: await SlugService.uniqueFor('products', target.id, p.name),
            sku: p.sku,
            description: p.description,
            sortOrder: p.sortOrder,
            price: p.price,
            cost: p.cost,
            taxRate: p.taxRate,
            lowStockThreshold: p.lowStockThreshold,
            status: p.status,
            stock: 0,
          },
          opts
        )
        prodMap.set(p.id, nuevo.id)

        await ProductVariation.create(
          {
            businessId: target.id,
            productId: nuevo.id,
            sku: p.sku,
            isDefault: true,
            price: p.price,
            stock: 0,
          },
          opts
        )

        const links = await q(CategoryProduct).where('product_id', p.id)
        for (const l of links) {
          const categoryId = catMap.get(l.categoryId)
          if (!categoryId) continue
          await CategoryProduct.create(
            {
              businessId: target.id,
              productId: nuevo.id,
              categoryId,
              subcategoryId: l.subcategoryId ? (subMap.get(l.subcategoryId) ?? null) : null,
            },
            opts
          )
        }

        const receta = await q(Recipe)
          .where('product_id', p.id)
          .preload('lines')
          .first()
        if (receta && receta.lines.length) {
          const r = await Recipe.create({ businessId: target.id, productId: nuevo.id }, opts)
          for (const l of receta.lines) {
            const ingredientId = ingMap.get(l.ingredientId)
            if (!ingredientId) continue
            await RecipeLine.create(
              {
                businessId: target.id,
                recipeId: r.id,
                ingredientId,
                quantity: l.quantity,
                wastePercent: l.wastePercent,
              },
              opts
            )
          }
          recipes++
        }

        const pmgs = await q(ProductModifierGroup).where('product_id', p.id).orderBy('sort_order')
        for (const m of pmgs) {
          const modifierGroupId = groupMap.get(m.modifierGroupId)
          if (!modifierGroupId) continue
          await ProductModifierGroup.create(
            {
              businessId: target.id,
              productId: nuevo.id,
              modifierGroupId,
              minSelect: m.minSelect,
              maxSelect: m.maxSelect,
              sortOrder: m.sortOrder,
            },
            opts
          )
        }
      }

      return {
        categories: catMap.size,
        subcategories: subMap.size,
        products: prodMap.size,
        ingredients: ingMap.size,
        recipes,
        modifierGroups: groupMap.size,
      }
    })
  }
}
