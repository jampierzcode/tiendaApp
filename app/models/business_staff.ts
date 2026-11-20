import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export type StaffRole = 'mesero' | 'cajero'

/**
 * Personal del negocio (meseras, cajeros). Cada uno tiene un `users` propio
 * para poder emitir tokens, pero entra con su nombre y un PIN, no con correo.
 */
export default class BusinessStaff extends BaseModel {
  static table = 'business_staff'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare userId: number

  @column()
  declare name: string

  @column()
  declare role: StaffRole

  @column({ serializeAs: null })
  declare pinHash: string

  @column()
  declare isActive: boolean

  @column({ serializeAs: null })
  declare failedAttempts: number

  @column.dateTime({ serializeAs: null })
  declare lockedUntil: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
