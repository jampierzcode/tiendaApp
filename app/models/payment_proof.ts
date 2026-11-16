import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Order from '#models/order'
import StorageService from '#services/storage_service'

export type EstadoComprobante = 'por_validar' | 'validado' | 'rechazado'

/**
 * Comprobante de pago que mandó el comprador por WhatsApp. No es un cobro:
 * el cobro (`payments`) nace recién cuando el dueño lo valida.
 */
export default class PaymentProof extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderId: number | null

  @column()
  declare paymentId: number | null

  @column()
  declare phone: string | null

  @column({
    consume: (url) => StorageService.urlAbsoluta(url),
    serialize: (url) => StorageService.urlAbsoluta(url),
    prepare: (url) => StorageService.urlRelativa(url),
  })
  declare imageUrl: string

  @column({ serializeAs: null })
  declare imageKey: string | null

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare amount: number | null

  @column()
  declare method: string | null

  @column()
  declare operationCode: string | null

  @column()
  declare paidAtText: string | null

  @column()
  declare payerName: string | null

  @column()
  declare aiNote: string | null

  @column()
  declare status: EstadoComprobante

  @column()
  declare rejectReason: string | null

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column()
  declare reviewedBy: number | null

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
