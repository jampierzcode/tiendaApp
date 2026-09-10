import { BaseModel, column, hasMany, belongsTo } from '@adonisjs/lucid/orm'
import Product from '#models/product'
import ProductVariationAttribute from '#models/product_variation_attribute'
import StockMovement from '#models/stock_movement'
import type { HasMany, BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ProductVariation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare productId: number

  @column()
  declare sku: string | null

  /**
   * Marca la variación única de un producto sin tallas ni colores. El panel
   * la esconde; existe para que el stock siempre viva en un solo sitio.
   */
  @column()
  declare isDefault: boolean

  @column()
  declare price: number

  /**
   * Saldo de inventario. Lo escribe únicamente InventoryService, que a la vez
   * deja la línea correspondiente en el kardex.
   */
  @column()
  declare stock: number

  @column()
  declare weight: number | null

  @column()
  declare priceModifier: number

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @hasMany(() => ProductVariationAttribute, { foreignKey: 'variationId' })
  declare attributes: HasMany<typeof ProductVariationAttribute>

  @hasMany(() => StockMovement, { foreignKey: 'productVariationId' })
  declare movements: HasMany<typeof StockMovement>
}
