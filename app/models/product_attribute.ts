import { BaseModel, column, hasMany, belongsTo } from '@adonisjs/lucid/orm'
import ProductAttributeValue from '#models/product_attribute_value'
import Business from '#models/business'
import type { HasMany, BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ProductAttribute extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare type: string

  @column()
  declare isRequired: boolean

  @column()
  declare isFilterable: boolean

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @hasMany(() => ProductAttributeValue, { foreignKey: 'attributeId' })
  declare values: HasMany<typeof ProductAttributeValue>
}
