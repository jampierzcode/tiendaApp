import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Printer from '#models/printer'

/** Destino de producción: Cocina, Parrilla, Barra… Puede tener impresora o no. */
export default class ProductionArea extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare printerId: number | null

  @column()
  declare sortOrder: number

  @column()
  declare isActive: boolean

  @belongsTo(() => Printer)
  declare printer: BelongsTo<typeof Printer>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
