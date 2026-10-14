import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class OrderItemModifier extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare orderItemId: number

  @column()
  declare modifierOptionId: number | null

  @column()
  declare groupName: string

  @column()
  declare optionName: string

  @column()
  declare priceDelta: number

  @column()
  declare quantity: number
}
