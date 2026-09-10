import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import Product from '#models/product'
import Category from '#models/category'
import Subcategory from '#models/subcategory'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class CategoryProduct extends BaseModel {
  // La tabla es singular; Lucid habría inferido `category_products`, que no existe.
  static table = 'category_product'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare productId: number

  @column()
  declare categoryId: number

  @column()
  declare subcategoryId: number | null

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => Category)
  declare category: BelongsTo<typeof Category>

  @belongsTo(() => Subcategory)
  declare subcategory: BelongsTo<typeof Subcategory>
}
