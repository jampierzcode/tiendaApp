import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import BusinessImage from '#models/business_image'
import Order from '#models/order'
import User from '#models/user'

export type MetodoPago = 'efectivo' | 'yape' | 'plin' | 'transferencia' | 'tarjeta' | 'otro'

/**
 * Un cobro sobre un pedido. Un pedido puede tener varios: la proforma pide
 * pagos parciales, así que un adelanto por Yape y el resto en efectivo al
 * entregar son dos filas, no un número que se sobrescribe.
 */
export default class Payment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderId: number

  @column()
  declare method: MetodoPago

  @column()
  declare amount: number

  /** Número de operación del Yape, Plin o la transferencia. */
  @column()
  declare reference: string | null

  @column()
  declare receiptImageId: number | null

  @column()
  declare note: string | null

  @column.dateTime()
  declare paidAt: DateTime

  @column()
  declare userId: number | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @belongsTo(() => BusinessImage, { foreignKey: 'receiptImageId' })
  declare receipt: BelongsTo<typeof BusinessImage>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
