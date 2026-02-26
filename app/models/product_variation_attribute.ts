import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import ProductVariation from '#models/product_variation'
import ProductAttributeValue from '#models/product_attribute_value'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ProductVariationAttribute extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare variationId: number

  @column()
  declare attributeValueId: number

  @belongsTo(() => ProductVariation)
  declare variation: BelongsTo<typeof ProductVariation>

  @belongsTo(() => ProductAttributeValue, { foreignKey: 'attributeValueId' })
  declare value: BelongsTo<typeof ProductAttributeValue>
}
