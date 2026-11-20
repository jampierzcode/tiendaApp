import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

const json = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: string | null) => (v ? JSON.parse(v) : null),
}

/** Jornada del negocio. Se cierra con el corte global. */
export default class Shift extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare number: number

  @column()
  declare status: 'abierto' | 'cerrado'

  @column()
  declare openedByUserId: number | null

  @column()
  declare openedByName: string | null

  @column.dateTime()
  declare openedAt: DateTime

  @column()
  declare closedByUserId: number | null

  @column()
  declare closedByName: string | null

  @column.dateTime()
  declare closedAt: DateTime | null

  @column(json)
  declare summary: Record<string, any> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
