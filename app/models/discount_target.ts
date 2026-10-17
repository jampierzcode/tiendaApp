import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Un destino de una promoción: un producto, una variación o una categoría. */
export default class DiscountTarget extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare discountId: number

  @column()
  declare kind: 'product' | 'variation' | 'category'

  @column()
  declare targetId: number
}
