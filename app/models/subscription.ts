import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, computed } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import Plan from '#models/plan'
import User from '#models/user'

/**
 * Un período contratado (o una prueba gratis) de un negocio. Es historial:
 * no se borra; si hubo un error se anula (`cancelled`).
 */
export default class Subscription extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare planId: number | null

  @column()
  declare planPriceId: number | null

  @column()
  declare planName: string

  @column()
  declare interval: 'trial' | 'month' | 'year'

  @column()
  declare quantity: number

  @column({ consume: (v) => Number(v) })
  declare unitPrice: number

  /** Precio × cantidad, antes del descuento. */
  @column({ consume: (v) => Number(v) })
  declare subtotal: number

  @column()
  declare discountType: 'percent' | 'amount' | null

  @column({ consume: (v) => (v === null ? null : Number(v)) })
  declare discountValue: number | null

  /** Lo que se descontó en soles. */
  @column({ consume: (v) => Number(v) })
  declare discountAmount: number

  /** Lo cobrado: subtotal − descuento. */
  @column({ consume: (v) => Number(v) })
  declare total: number

  @column()
  declare currency: string

  @column.dateTime()
  declare startsAt: DateTime

  @column.dateTime()
  declare endsAt: DateTime

  @column()
  declare status: 'trial' | 'active' | 'cancelled'

  @column()
  declare paymentMethod: string | null

  @column()
  declare paymentReference: string | null

  @column()
  declare notes: string | null

  @column()
  declare createdBy: number | null

  @column.dateTime()
  declare cancelledAt: DateTime | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @belongsTo(() => Plan)
  declare plan: BelongsTo<typeof Plan>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  /** Estado para mostrar: vigente, programada (empieza después), vencida o anulada. */
  @computed()
  get state(): 'vigente' | 'programada' | 'vencida' | 'anulada' {
    if (this.status === 'cancelled') return 'anulada'
    const ahora = DateTime.now()
    if (this.startsAt > ahora) return 'programada'
    if (this.endsAt < ahora) return 'vencida'
    return 'vigente'
  }

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
