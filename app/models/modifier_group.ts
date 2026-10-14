import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ModifierOption from '#models/modifier_option'

/** "Tipo de carne", "Extras", "Bebida": un conjunto de opciones reutilizable. */
export default class ModifierGroup extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
  declare isActive: boolean

  @hasMany(() => ModifierOption)
  declare options: HasMany<typeof ModifierOption>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
