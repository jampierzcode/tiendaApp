import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class DiningTable extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare zone: string | null

  /** Área del comedor (Primer piso, Terraza…). `zone` guarda su nombre. */
  @column()
  declare diningAreaId: number | null

  @column()
  declare seats: number | null

  @column()
  declare sortOrder: number

  @column()
  declare isActive: boolean

  /** Ya se cobró pero la mesa no se ha liberado (limpieza). */
  @column()
  declare needsRelease: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
