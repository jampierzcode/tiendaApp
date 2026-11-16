import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Mientras `pausedUntil` no pase, el asistente de IA no le contesta a ese cliente. */
export default class WhatsappAgentPause extends BaseModel {
  public static table = 'whatsapp_agent_pauses'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare contact: string

  @column.dateTime()
  declare pausedUntil: DateTime

  @column()
  declare reason: string | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
