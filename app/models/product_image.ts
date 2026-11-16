import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import BusinessImage from '#models/business_image'

/**
 * Foto extra de la galería de un producto. Con `productVariationId` es de esa
 * variación (p. ej. las fotos del color negro); sin él, del producto.
 */
export default class ProductImage extends BaseModel {
  public static table = 'product_images'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare productId: number

  @column()
  declare productVariationId: number | null

  @column()
  declare businessImageId: number

  @column()
  declare sortOrder: number

  @belongsTo(() => BusinessImage)
  declare image: BelongsTo<typeof BusinessImage>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
