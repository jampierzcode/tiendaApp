import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Business from '#models/business'
import StorageService from '#services/storage_service'

export default class BusinessImage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  /**
   * En la base va relativa (`/media/<key>`); al leerla se completa con el
   * dominio por el que llegó el request, y al guardarla se le vuelve a quitar.
   * Así la misma fila vale en local y en producción.
   */
  @column({
    consume: (url) => StorageService.urlAbsoluta(url),
    serialize: (url) => StorageService.urlAbsoluta(url),
    prepare: (url) => StorageService.urlRelativa(url),
  })
  declare url: string

  /** Clave del objeto en el bucket. Null si la URL es externa. */
  @column()
  declare storageKey: string | null

  @column()
  declare sizeBytes: number | null

  @column()
  declare contentType: string | null

  @column()
  declare name: string | null

  @column()
  declare description: string | null

  @column()
  declare type: 'producto' | 'banner' | 'logo' | 'galeria'

  @column()
  declare status: 'activo' | 'inactivo'

  @belongsTo(() => Business)
  declare business: BelongsTo<typeof Business>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
