import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Ingreso o retiro de efectivo de la caja (sencillo, gasto, retiro a bóveda…). */
export default class CashMovement extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare cashSessionId: number

  @column()
  declare type: 'ingreso' | 'retiro'

  @column({ consume: (v) => Number(v) })
  declare amount: number

  @column()
  declare reason: string

  @column()
  declare userId: number | null

  @column()
  declare userName: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
