import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class PurchaseReceiptItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare receiptId: number

  @column()
  declare purchaseOrderItemId: number

  @column()
  declare productVariationId: number

  @column()
  declare quantity: number

  @column()
  declare unitCost: number
}
