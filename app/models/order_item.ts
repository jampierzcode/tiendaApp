import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import OrderItemModifier from '#models/order_item_modifier'
import Order from '#models/order'
import Product from '#models/product'
import ProductVariation from '#models/product_variation'

/**
 * Una línea del pedido. Guarda copia del nombre, el precio y la variación
 * porque el pedido tiene que seguir diciendo lo que el cliente pagó aunque
 * después cambien el producto o lo borren.
 */
export default class OrderItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderId: number

  @column()
  declare productId: number | null

  @column()
  declare productVariationId: number | null

  @column()
  declare productName: string

  @column()
  declare sku: string | null

  /** "Talla M · Color Negro" */
  @column()
  declare variationLabel: string | null

  @column()
  declare unitPrice: number

  @column()
  declare unitCost: number | null

  @column()
  declare discountPercentage: number

  @column()
  declare promotionName: string | null

  @column()
  declare quantity: number

  @column()
  declare lineTotal: number

  /** "Sin cebolla, por favor". */
  @column()
  declare note: string | null

  /** PDV de salón: ronda en que se comandó y área a la que salió. */
  @column()
  declare orderRoundId: number | null

  @column()
  declare productionAreaId: number | null

  @column()
  declare productionAreaName: string | null

  /** Anulado: sigue en la cuenta para el historial, pero no se cobra. */
  @column.dateTime()
  declare voidedAt: DateTime | null

  @column()
  declare voidReason: string | null

  @column()
  declare isCourtesy: boolean

  @column()
  declare voidedByUserId: number | null

  @hasMany(() => OrderItemModifier)
  declare modifiers: HasMany<typeof OrderItemModifier>

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => ProductVariation)
  declare variation: BelongsTo<typeof ProductVariation>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
