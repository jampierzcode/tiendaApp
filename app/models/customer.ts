import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import Order from '#models/order'

export default class Customer extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare phone: string

  @column()
  declare email: string | null

  @column()
  declare document: string | null

  @column()
  declare address: string | null

  @column()
  declare city: string | null

  @column()
  declare notes: string | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @hasMany(() => Order)
  declare orders: HasMany<typeof Order>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
