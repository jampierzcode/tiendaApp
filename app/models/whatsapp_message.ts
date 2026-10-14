import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class WhatsappMessage extends BaseModel {
  public static table = 'whatsapp_messages'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare contact: string

  @column()
  declare phone: string

  @column()
  declare direction: 'in' | 'out'

  @column()
  declare body: string

  @column()
  declare automatic: boolean

  @column.dateTime()
  declare readAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
