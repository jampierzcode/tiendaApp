import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ProductVariation from '#models/product_variation'
import PurchaseOrder from '#models/purchase_order'

export default class PurchaseOrderItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare purchaseOrderId: number

  @column()
  declare productVariationId: number

  @column()
  declare quantity: number

  @column()
  declare unitCost: number

  @column()
  declare lineTotal: number

  @belongsTo(() => PurchaseOrder)
  declare purchaseOrder: BelongsTo<typeof PurchaseOrder>

  @belongsTo(() => ProductVariation, { foreignKey: 'productVariationId' })
  declare variation: BelongsTo<typeof ProductVariation>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
