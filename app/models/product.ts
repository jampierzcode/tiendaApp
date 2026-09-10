import { BaseModel, column, belongsTo, hasMany, hasOne, manyToMany } from '@adonisjs/lucid/orm'
import Business from './business.js'
import Discount from './discount.js'
import type { BelongsTo, HasMany, HasOne, ManyToMany } from '@adonisjs/lucid/types/relations'
import BusinessImage from './business_image.js'
import ProductVariation from './product_variation.js'
import CategoryProduct from './category_product.js'
import Tag from './tag.js'

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

  @column()
  declare businessImageId: number | null

  @column()
  declare status: 'activo' | 'inactivo'

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
