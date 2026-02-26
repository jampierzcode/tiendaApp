import { DateTime } from 'luxon'
import { BaseModel, column, hasMany, belongsTo } from '@adonisjs/lucid/orm'
import type { HasMany, BelongsTo } from '@adonisjs/lucid/types/relations'
import Subcategory from '#models/subcategory'
import Business from '#models/business'

export default class Category extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare slug: string

  @column()
  declare imageUrl: string | null

  @column()
  declare description: string | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @hasMany(() => Subcategory)
  declare subcategories: HasMany<typeof Subcategory>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
