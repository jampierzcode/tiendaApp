import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class WhatsappOutbox extends BaseModel {
  public static table = 'whatsapp_outbox'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderId: number | null

  @column()
  declare phone: string

  @column()
  declare event: string

  @column()
  declare body: string

  @column()
  declare status: 'pendiente' | 'enviando' | 'enviado' | 'error'

  @column()
  declare attempts: number

  @column()
  declare error: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare sentAt: DateTime | null
}
