import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import Category from '#models/category'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Subcategory extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare categoryId: number

  @column()
  declare name: string

  @column()
  declare slug: string

  @column()
  declare imageUrl: string | null

  @column()
  declare description: string | null

  @belongsTo(() => Category)
  declare category: BelongsTo<typeof Category>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
