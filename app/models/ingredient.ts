import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Ingredient extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare unit: string

  @column()
  declare stock: number

  @column()
  declare minStock: number

  @column()
  declare avgCost: number

  @column()
  declare isActive: boolean

  /** Carnes, Verduras, Bebidas… para agrupar y contar por partes. */
  @column()
  declare category: string | null

  /** insumo (se compra) | preparacion (se produce con otros: salsa, masa). */
  @column()
  declare kind: 'insumo' | 'preparacion'

  /** Cómo se compra (saco, caja); null = en la misma unidad de uso. */
  @column()
  declare purchaseUnit: string | null

  /** Unidades de uso por unidad de compra: 1 saco = 50 kg. */
  @column()
  declare purchaseFactor: number

  /** Preparación: cuánto rinde una tanda. */
  @column()
  declare yieldQty: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
