import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Plan from '#models/plan'

export type IntervaloPrecio = 'month' | 'year'

/** Precio de un plan por intervalo: el mensual y el anual se editan por separado. */
export default class PlanPrice extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare planId: number

  @column()
  declare interval: IntervaloPrecio

  @column({ consume: (v) => Number(v) })
  declare price: number

  @column()
  declare currency: string

  @column()
  declare isActive: boolean

  @belongsTo(() => Plan)
  declare plan: BelongsTo<typeof Plan>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
