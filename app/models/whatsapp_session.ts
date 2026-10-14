import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type WhatsappSessionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

/**
 * Estado del número de WhatsApp de un negocio. El panel escribe `desired`
 * (lo que el dueño quiere) y el servicio del bot escribe `status` y `qr`
 * (lo que realmente pasa).
 */
export default class WhatsappSession extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare desired: 'connected' | 'disconnected'

  @column()
  declare status: WhatsappSessionStatus

  @column()
  declare qr: string | null

  @column()
  declare connectedPhone: string | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
