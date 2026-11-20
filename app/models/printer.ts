import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Impresora del local. Aquí solo vive el nombre y el papel: con qué equipo
 * Bluetooth se empareja lo recuerda la central en su propio navegador.
 */
export default class Printer extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare paperWidth: number

  @column()
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
