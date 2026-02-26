import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'

export default class BusinessImage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare url: string

  @column()
  declare name: string | null

  @column()
  declare description: string | null

  @column()
  declare type: 'producto' | 'banner' | 'logo' | 'galeria'

  @column()
  declare status: 'activo' | 'inactivo'

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
