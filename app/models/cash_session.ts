import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CashRegister from '#models/cash_register'

const json = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: string | null) => (v ? JSON.parse(v) : null),
}

/** Una caja abierta por una persona dentro de un turno. */
export default class CashSession extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare shiftId: number

  @column()
  declare cashRegisterId: number

  @column()
  declare status: 'abierta' | 'cerrada'

  @column()
  declare userId: number | null

  @column()
  declare userName: string | null

  @column({ consume: (v) => Number(v) })
  declare openingFloat: number

  @column.dateTime()
  declare openedAt: DateTime

  @column.dateTime()
  declare closedAt: DateTime | null

  @column()
  declare closedByUserId: number | null

  @column()
  declare closedByName: string | null

  @column()
  declare zNumber: number | null

  @column(json)
  declare declared: Record<string, number> | null

  @column(json)
  declare expected: Record<string, number> | null

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare difference: number | null

  @column()
  declare note: string | null

  @belongsTo(() => CashRegister)
  declare register: BelongsTo<typeof CashRegister>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
