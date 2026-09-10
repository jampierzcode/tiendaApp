import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import PurchaseOrderItem from '#models/purchase_order_item'
import Supplier from '#models/supplier'
import User from '#models/user'

export type EstadoCompra = 'borrador' | 'recibida' | 'cancelada'

/**
 * Orden de compra a un proveedor.
 *
 * Nace en borrador y solo al marcarla recibida entra la mercadería al
 * inventario: pedirle 50 polos al proveedor no es lo mismo que tenerlos.
 */
export default class PurchaseOrder extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare supplierId: number

  @column()
  declare code: string

  /** Número de la factura o guía que entregó el proveedor. */
  @column()
  declare documentNumber: string | null

  @column()
  declare status: EstadoCompra

  @column()
  declare total: number

  @column()
  declare note: string | null

  @column.dateTime()
  declare receivedAt: DateTime | null

  @column()
  declare userId: number | null

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @belongsTo(() => Supplier)
  declare supplier: BelongsTo<typeof Supplier>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => PurchaseOrderItem)
  declare items: HasMany<typeof PurchaseOrderItem>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
