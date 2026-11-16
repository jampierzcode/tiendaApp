import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Consumo de OpenAI de una llamada del vendedor IA. */
export default class AiUsage extends BaseModel {
  public static table = 'ai_usage'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number | null

  @column()
  declare model: string

  @column()
  declare promptTokens: number

  @column()
  declare cachedTokens: number

  @column()
  declare completionTokens: number

  @column({ consume: (v) => Number(v) })
  declare costUsd: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
