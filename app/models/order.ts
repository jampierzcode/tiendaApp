import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import Customer from '#models/customer'
import OrderItem from '#models/order_item'
import Payment from '#models/payment'

export type OrderStatus =
  | 'pendiente'
  | 'confirmado'
  | 'pagado'
  | 'enviado'
  | 'entregado'
  | 'cancelado'
  | 'devuelto'

export type OrderChannel = 'whatsapp' | 'mostrador' | 'online'

export default class Order extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  /** Código corto que el cliente cita por WhatsApp. */
  @column()
  declare code: string

  @column()
  declare customerId: number | null

  @column()
  declare channel: OrderChannel

  @column()
  declare status: OrderStatus

  @column()
  declare customerName: string

  @column()
  declare customerPhone: string | null

  /** Serie y correlativo del ticket. Enganche para SUNAT más adelante. */
  @column()
  declare documentSeries: string | null

  @column()
  declare documentNumber: number | null

  @column()
  declare deliveryMethod: string

  @column()
  declare deliveryAddress: string | null

  @column()
  declare deliveryCity: string | null

  @column()
  declare note: string | null

  @column()
  declare subtotal: number

  @column()
  declare discountTotal: number

  @column()
  declare shippingCost: number

  @column()
  declare total: number

  @column()
  declare paidTotal: number

  @column()
  declare currency: string

  // --- Envío ---

  /** Olva, Shalom, motorizado propio… */
  @column()
  declare courier: string | null

  @column()
  declare trackingCode: string | null

  @column()
  declare trackingUrl: string | null

  @column.dateTime()
  declare shippedAt: DateTime | null

  @column.dateTime()
  declare deliveredAt: DateTime | null

  @column.dateTime()
  declare whatsappSentAt: DateTime | null

  /** Cuándo se descontó el stock, para no descontarlo dos veces. */
  @column.dateTime()
  declare stockCommittedAt: DateTime | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  @hasMany(() => OrderItem)
  declare items: HasMany<typeof OrderItem>

  @hasMany(() => Payment)
  declare payments: HasMany<typeof Payment>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  get saldoPendiente() {
    return Number(this.total) - Number(this.paidTotal)
  }
}
