import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
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
  declare quantity: number

  @column()
  declare lineTotal: number

  @belongsTo(() => Order)
  declare order: BelongsTo<typeof Order>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => ProductVariation)
  declare variation: BelongsTo<typeof ProductVariation>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
