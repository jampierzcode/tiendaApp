import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import PurchaseOrder from '#models/purchase_order'

export default class Supplier extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare ruc: string | null

  @column()
  declare contactName: string | null

  @column()
  declare phone: string | null

  @column()
  declare email: string | null

  @column()
  declare address: string | null

  @column()
  declare notes: string | null

  @column()
  declare status: 'activo' | 'inactivo'

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @hasMany(() => PurchaseOrder)
  declare purchaseOrders: HasMany<typeof PurchaseOrder>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
