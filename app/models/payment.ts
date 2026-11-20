import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, beforeCreate } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import BusinessImage from '#models/business_image'
import Order from '#models/order'
import User from '#models/user'
import StorageService from '#services/storage_service'
import db from '@adonisjs/lucid/services/db'

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

  /** Sesión de caja abierta cuando entró el cobro (para los cortes X/Z). */
  @column()
  declare cashSessionId: number | null

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

  /**
   * Todo cobro (salón, mostrador, pedido online) cae en la caja abierta: la
   * de quien cobra si tiene una, o la única abierta del negocio. Sin caja
   * abierta queda sin sesión, como antes de existir los cortes.
   */
  @beforeCreate()
  static async asignarCaja(payment: Payment) {
    if (payment.cashSessionId) return
    const cliente = payment.$trx ?? db
    const abiertas = await cliente
      .from('cash_sessions')
      .where('business_id', payment.businessId)
      .andWhere('status', 'abierta')
      .select('id', 'user_id')
    const propia = abiertas.find((s) => payment.userId && s.user_id === payment.userId)
    if (propia) payment.cashSessionId = propia.id
    else if (abiertas.length === 1) payment.cashSessionId = abiertas[0].id
  }
}
