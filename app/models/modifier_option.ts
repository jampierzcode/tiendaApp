import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ModifierGroup from '#models/modifier_group'

export default class ModifierOption extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare modifierGroupId: number

  @column()
  declare name: string

  /** Cuánto suma (o resta) al precio del plato. */
  @column()
  declare priceDelta: number

  @column()
  declare isActive: boolean

  @column()
  declare sortOrder: number

  /** Insumo que consume esta opción (queso extra → queso), si aplica. */
  @column()
  declare ingredientId: number | null

  @column()
  declare ingredientQty: number

  @belongsTo(() => ModifierGroup)
  declare group: BelongsTo<typeof ModifierGroup>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
