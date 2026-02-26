import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import Business from './business.js'
import Discount from './discount.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import BusinessImage from './business_image.js'
import ProductVariation from './product_variation.js'

export default class Product extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
  declare price: number

  @column()
  declare stock: number

  @column()
  declare businessImageId: number | null

  @column()
  declare status: 'activo' | 'inactivo'

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @hasMany(() => ProductVariation)
  declare variations: HasMany<typeof ProductVariation>

  @belongsTo(() => BusinessImage)
  declare businessImages: BelongsTo<typeof BusinessImage>

  @hasMany(() => Discount)
  declare discounts: HasMany<typeof Discount>
}
