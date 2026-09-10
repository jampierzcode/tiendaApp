import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import ProductVariation from '#models/product_variation'
import User from '#models/user'

export type StockMovementType =
  | 'compra'
  | 'venta'
  | 'devolucion'
  | 'ajuste'
  | 'inicial'
  | 'merma'

/**
 * Una línea del kardex. Nunca se edita ni se borra: para corregir un error
 * se registra un movimiento de tipo `ajuste` en sentido contrario, igual
 * que en un libro contable.
 */
export default class StockMovement extends BaseModel {
  static table = 'stock_movements'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare productVariationId: number

  @column()
  declare type: StockMovementType

  /** Con signo: positivo entra al inventario, negativo sale. */
  @column()
  declare quantity: number

  /** Saldo de la variación justo después de este movimiento. */
  @column()
  declare balanceAfter: number

  @column()
  declare unitCost: number | null

  @column()
  declare referenceType: string | null

  @column()
  declare referenceId: number | null

  @column()
  declare note: string | null

  @column()
  declare userId: number | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @belongsTo(() => ProductVariation)
  declare variation: BelongsTo<typeof ProductVariation>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
