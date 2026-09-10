import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Order from '#models/order'
import ReturnItem from '#models/return_item'
import User from '#models/user'

/**
 * Devolución de un pedido, total o parcial.
 *
 * Se guarda como documento aparte en vez de tocar el pedido original: el
 * pedido tiene que seguir diciendo lo que se vendió, y la devolución lo que
 * volvió. Restar del pedido borraría el rastro de la venta.
 */
export default class ReturnNote extends BaseModel {
  static table = 'returns'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderId: number

  @column()
  declare code: string

  @column()
  declare reason: string | null

  @column()
  declare total: number

  /** Si la mercadería vuelve al inventario o se da por perdida. */
  @column()
  declare restocked: boolean

  @column()
  declare userId: number | null

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => ReturnItem, { foreignKey: 'returnId' })
  declare items: HasMany<typeof ReturnItem>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
