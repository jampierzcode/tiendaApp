import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import Product from '#models/product'

export default class Tag extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare slug: string

  @column()
  declare color: string | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @manyToMany(() => Product, {
    pivotTable: 'product_tag',
    pivotColumns: ['business_id'],
  })
  declare products: ManyToMany<typeof Product>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
