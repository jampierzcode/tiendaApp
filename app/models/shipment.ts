import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ShipmentEvent from '#models/shipment_event'

export type EstadoEnvio = 'preparando' | 'en_transito' | 'entregado' | 'incidencia' | 'cancelado'

/**
 * Seguimiento de un envío: `compra` (llega del proveedor) o `pedido` (sale
 * hacia el cliente). Que un envío figure como entregado NO mete stock: el
 * inventario solo sube cuando se registra la recepción física.
 */
export default class Shipment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare kind: 'compra' | 'pedido'

  @column()
  declare purchaseOrderId: number | null

  @column()
  declare orderId: number | null

  @column()
  declare carrier: string | null

  @column()
  declare trackingCode: string | null

  @column()
  declare trackingUrl: string | null

  @column()
  declare status: EstadoEnvio

  @column.dateTime()
  declare shippedAt: DateTime | null

  @column()
  declare estimatedAt: string | null

  @column.dateTime()
  declare deliveredAt: DateTime | null

  @column()
  declare note: string | null

  @hasMany(() => ShipmentEvent)
  declare events: HasMany<typeof ShipmentEvent>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
