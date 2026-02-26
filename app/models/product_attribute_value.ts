import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import ProductAttribute from '#models/product_attribute'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ProductAttributeValue extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare attributeId: number

  @column()
  declare value: string

  @column()
  declare hexColor: string | null

  @belongsTo(() => ProductAttribute, { foreignKey: 'attributeId' })
  declare attribute: BelongsTo<typeof ProductAttribute>
}
