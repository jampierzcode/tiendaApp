import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import Product from './product.js'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Discount extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare productId: number

  @column()
  declare percentage: number

  @column.date()
  declare startDate: DateTime

  @column.date()
  declare endDate: DateTime

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
