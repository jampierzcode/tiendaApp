import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Una "Enviar comanda" de la cuenta de una mesa. */
export default class OrderRound extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderId: number

  @column()
  declare number: number

  @column()
  declare clientRequestId: string

  @column()
  declare userId: number | null

  @column()
  declare userName: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
