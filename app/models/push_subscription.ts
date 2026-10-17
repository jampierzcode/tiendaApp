import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class PushSubscription extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare endpoint: string

  @column({ columnName: 'p256dh' })
  declare p256dh: string

  @column()
  declare auth: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
