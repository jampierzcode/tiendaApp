import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ShipmentEvent extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare shipmentId: number

  @column()
  declare status: string

  @column()
  declare note: string | null

  @column.dateTime()
  declare happenedAt: DateTime

  @column()
  declare userId: number | null
}
