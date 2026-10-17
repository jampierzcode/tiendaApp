import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import PurchaseReceiptItem from '#models/purchase_receipt_item'

/** Una entrada física de mercadería de una orden de compra (total o parcial). */
export default class PurchaseReceipt extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare purchaseOrderId: number

  @column()
  declare shipmentId: number | null

  @column()
  declare code: string

  @column()
  declare documentNumber: string | null

  @column()
  declare note: string | null

  @column()
  declare userId: number | null

  @column.dateTime()
  declare receivedAt: DateTime

  @hasMany(() => PurchaseReceiptItem, { foreignKey: 'receiptId' })
  declare items: HasMany<typeof PurchaseReceiptItem>
}
