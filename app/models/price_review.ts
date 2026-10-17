import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Product from '#models/product'

/**
 * Aviso de que un costo subió y conviene revisar el precio de venta. Solo
 * sugiere: el precio cambia únicamente cuando alguien lo aplica y confirma.
 */
export default class PriceReview extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare productId: number

  @column()
  declare purchaseReceiptId: number | null

  @column()
  declare supplierId: number | null

  @column()
  declare oldCost: number

  @column()
  declare newCost: number

  @column()
  declare currentPrice: number

  @column()
  declare suggestedPrice: number

  @column()
  declare appliedPrice: number | null

  @column()
  declare status: 'pendiente' | 'aplicada' | 'descartada'

  @column.dateTime()
  declare resolvedAt: DateTime | null

  @column()
  declare resolvedBy: number | null

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
