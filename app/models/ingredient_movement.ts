import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type TipoMovimientoInsumo =
  | 'inicial'
  | 'compra'
  | 'ajuste'
  | 'merma'
  | 'consumo'
  | 'devolucion'

export default class IngredientMovement extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare ingredientId: number

  @column()
  declare type: TipoMovimientoInsumo

  @column()
  declare quantity: number

  @column()
  declare unitCost: number | null

  @column()
  declare stockAfter: number

  @column()
  declare referenceType: string | null

  @column()
  declare referenceId: number | null

  @column()
  declare note: string | null

  @column()
  declare userId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
