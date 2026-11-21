import { BaseModel, column, belongsTo, hasMany, hasOne, manyToMany } from '@adonisjs/lucid/orm'
import Business from './business.js'
import Discount from './discount.js'
import type { BelongsTo, HasMany, HasOne, ManyToMany } from '@adonisjs/lucid/types/relations'
import BusinessImage from './business_image.js'
import ProductVariation from './product_variation.js'
import CategoryProduct from './category_product.js'
import Tag from './tag.js'
import ProductImage from './product_image.js'
import StorageService from '#services/storage_service'

/** Pregunta frecuente del producto; la foto (opcional) es de la galería del negocio. */
export type ProductFaq = {
  pregunta: string
  respuesta: string
  imagenId?: number | null
  imagenUrl?: string | null
}

export default class Product extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare slug: string

  @column()
  declare sku: string | null

  @column()
  declare description: string | null

  @column()
  declare sortOrder: number

  /** Área de producción (cocina, barra…). Null = la de su categoría. */
  @column()
  declare productionAreaId: number | null

  @column()
  declare price: number

  /** Precio de costo. Sin esto no hay margen que reportar. */
  @column()
  declare cost: number | null

  /** IGV aplicable al producto, en porcentaje. */
  @column()
  declare taxRate: number

  /**
   * Total cacheado de las variaciones. Solo lectura: lo mantiene
   * InventoryService, no se escribe a mano.
   */
  @column()
  declare stock: number

  @column()
  declare lowStockThreshold: number

  /** Se vende sin mirar el inventario: nunca se agota. */
  @column()
  declare unlimitedStock: boolean

  /**
   * Preguntas frecuentes del producto para el vendedor IA. En la base es
   * TEXT con JSON; aquí siempre es un arreglo (vacío si no hay o está roto).
   */
  @column({
    prepare: (v: ProductFaq[] | null) => (v && v.length ? JSON.stringify(v) : null),
    consume: (v: string | null) => {
      if (!v) return []
      try {
        const a = JSON.parse(v)
        return Array.isArray(a) ? a : []
      } catch {
        return []
      }
    },
    // Al panel la foto le llega con dominio, igual que las de la galería.
    serialize: (v: ProductFaq[]) =>
      (v ?? []).map((f) => (f.imagenUrl ? { ...f, imagenUrl: StorageService.urlAbsoluta(f.imagenUrl) } : f)),
  })
  declare aiFaqs: ProductFaq[]

  @column()
  declare businessImageId: number | null

  @column()
  declare status: 'activo' | 'inactivo'

  /** Día (AAAA-MM-DD, Lima) para el que se eligió en una categoría «cambia cada día». */
  @column()
  declare menuDate: string | null

  /** Día (AAAA-MM-DD, Lima) en que se acabó: ese día no se vende y vuelve solo al siguiente. */
  @column()
  declare soldOutDate: string | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @hasMany(() => ProductVariation)
  declare variations: HasMany<typeof ProductVariation>

  /** La variación que representa a un producto sin tallas ni colores. */
  @hasOne(() => ProductVariation, {
    onQuery: (query) => query.where('is_default', true),
  })
  declare defaultVariation: HasOne<typeof ProductVariation>

  @belongsTo(() => BusinessImage)
  declare businessImages: BelongsTo<typeof BusinessImage>

  /** Galería completa (del producto y de sus variaciones), en orden. */
  @hasMany(() => ProductImage)
  declare gallery: HasMany<typeof ProductImage>

  @hasMany(() => CategoryProduct)
  declare categoryLinks: HasMany<typeof CategoryProduct>

  @manyToMany(() => Tag, {
    pivotTable: 'product_tag',
    pivotColumns: ['business_id'],
  })
  declare tags: ManyToMany<typeof Tag>

  @hasMany(() => Discount)
  declare discounts: HasMany<typeof Discount>
}
