import Business from '#models/business'
import Category from '#models/category'
import CategoryProduct from '#models/category_product'
import ModifierGroup from '#models/modifier_group'
import ModifierOption from '#models/modifier_option'
import Product from '#models/product'
import ProductModifierGroup from '#models/product_modifier_group'
import ProductVariation from '#models/product_variation'
import type User from '#models/user'
import InventoryService from '#services/inventory_service'
import SlugService from '#services/slug_service'
import { findTemplate } from '#services/templates/catalog_templates'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

export const TRIAL_DAYS = 7

export type BusinessInput = {
  name: string
  business_type: 'retail' | 'restaurant'
  template?: string
  whatsapp_phone: string
  city?: string
  address?: string
  schedule?: string
  description?: string
  primary_color?: string
  secondary_color?: string
}

/**
 * Alta de un negocio listo para operar: activo, público, en prueba gratis de
 * 7 días y con el catálogo de arranque de su rubro.
 *
 * Todo en una transacción: o queda el negocio completo o no queda nada, para
 * que un fallo a mitad del catálogo no deje tiendas a medias.
 */
export default class OnboardingService {
  static async createBusiness(owner: User, input: BusinessInput) {
    const template = findTemplate(input.template)

    // La plantilla manda sobre el tipo: no se puede sembrar un menú en retail.
    if (input.template && !template) throw new Error('La plantilla elegida no existe')
    if (template && template.businessType !== input.business_type) {
      throw new Error('La plantilla no corresponde al tipo de negocio')
    }

    return db.transaction(async (trx) => {
      const opts = { client: trx }

      const business = await Business.create(
        {
          uuid: randomUUID(),
          userId: owner.id,
          name: input.name,
          description: input.description ?? null,
          businessType: input.business_type,
          businessSubtype: template?.key ?? null,
          whatsappPhone: input.whatsapp_phone,
          city: input.city ?? null,
          address: input.address ?? null,
          schedule: input.schedule ?? null,
          primaryColor: input.primary_color ?? '#0F172A',
          secondaryColor: input.secondary_color ?? '#F97316',
          currency: 'PEN',
          currencySymbol: 'S/',
          status: 'activo',
          isPublic: true,
          subscriptionStatus: 'trial',
          trialEndsAt: DateTime.now().plus({ days: TRIAL_DAYS }),
        },
        opts
      )

      let products = 0

      if (template) {
        const catIds = new Map<string, number>()
        const prodsByCategory = new Map<string, number[]>()

        for (const [ci, cat] of template.categories.entries()) {
          const category = await Category.create(
            {
              businessId: business.id,
              name: cat.name,
              slug: await SlugService.uniqueFor('categories', business.id, cat.name),
              sortOrder: ci,
              isActive: true,
            },
            opts
          )
          catIds.set(cat.name, category.id)
          prodsByCategory.set(cat.name, [])

          for (const [pi, item] of cat.products.entries()) {
            const sku = `${business.id}-${ci + 1}${String(pi + 1).padStart(2, '0')}`
            const product = await Product.create(
              {
                businessId: business.id,
                name: item.name,
                slug: await SlugService.uniqueFor('products', business.id, item.name),
                sku,
                description: item.description ?? null,
                price: item.price,
                cost: item.cost ?? 0,
                taxRate: 18,
                lowStockThreshold: 5,
                sortOrder: pi,
                stock: 0,
                status: 'activo',
              },
              opts
            )

            const variation = await ProductVariation.create(
              {
                businessId: business.id,
                productId: product.id,
                sku,
                isDefault: true,
                price: item.price,
                stock: 0,
              },
              opts
            )

            await CategoryProduct.create(
              { businessId: business.id, productId: product.id, categoryId: category.id },
              opts
            )

            // Solo retail lleva stock; un plato no se cuenta por unidades.
            if (template.businessType === 'retail' && template.initialStock) {
              await InventoryService.applyMovement({
                businessId: business.id,
                variationId: variation.id,
                type: 'inicial',
                quantity: template.initialStock,
                unitCost: item.cost ?? 0,
                note: 'Stock de ejemplo de la plantilla',
                userId: owner.id,
                trx,
              })
            }

            prodsByCategory.get(cat.name)!.push(product.id)
            products++
          }
        }

        for (const group of template.modifierGroups ?? []) {
          const mg = await ModifierGroup.create(
            { businessId: business.id, name: group.name, isActive: true },
            opts
          )
          for (const [oi, option] of group.options.entries()) {
            await ModifierOption.create(
              {
                businessId: business.id,
                modifierGroupId: mg.id,
                name: option.name,
                priceDelta: option.priceDelta ?? 0,
                isActive: true,
                sortOrder: oi,
              },
              opts
            )
          }
          for (const catName of group.appliesTo) {
            for (const productId of prodsByCategory.get(catName) ?? []) {
              await ProductModifierGroup.create(
                {
                  businessId: business.id,
                  productId,
                  modifierGroupId: mg.id,
                  minSelect: group.minSelect ?? 0,
                  maxSelect: group.maxSelect ?? group.options.length,
                  sortOrder: 0,
                },
                opts
              )
            }
          }
        }
      }

      return { business, products }
    })
  }
}
