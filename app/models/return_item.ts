import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OrderItem from '#models/order_item'
import ReturnNote from '#models/return_note'

export default class ReturnItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare returnId: number

  @column()
  declare orderItemId: number

  @column()
  declare quantity: number

  @column()
  declare lineTotal: number

  @belongsTo(() => ReturnNote, { foreignKey: 'returnId' })
  declare returnNote: BelongsTo<typeof ReturnNote>

  @belongsTo(() => OrderItem)
  declare orderItem: BelongsTo<typeof OrderItem>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
