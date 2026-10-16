import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import BusinessImage from '#models/business_image'
import Order from '#models/order'
import User from '#models/user'
import StorageService from '#services/storage_service'

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

  /** Comprobante subido directo al bucket, sin pasar por la galería. */
  @column({
    consume: (url) => StorageService.urlAbsoluta(url),
    serialize: (url) => StorageService.urlAbsoluta(url),
    prepare: (url) => StorageService.urlRelativa(url),
  })
  declare receiptUrl: string | null

  @column()
  declare receiptKey: string | null

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
