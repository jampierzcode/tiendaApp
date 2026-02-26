import { BaseModel, column, hasMany, belongsTo } from '@adonisjs/lucid/orm'
import Product from '#models/product'
import ProductVariationAttribute from '#models/product_variation_attribute'
import type { HasMany, BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ProductVariation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare productId: number

  @column()
  declare sku: string | null

  @column()
  declare price: number

  @column()
  declare stock: number

  @column()
  declare weight: number | null

  @column()
  declare priceModifier: number

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @hasMany(() => ProductVariationAttribute, { foreignKey: 'variationId' })
  declare attributes: HasMany<typeof ProductVariationAttribute>
}
