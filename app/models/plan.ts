import { DateTime } from 'luxon'
import { BaseModel, column, computed, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import PlanPrice from '#models/plan_price'
import { esFuncion, type Funcion } from '#services/plan_features'

/** Plan comercial (Carta, Pedidos, Pedidos + IA…) con las funciones que incluye. */
export default class Plan extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: string

  @column()
  declare name: string

  @column()
  declare tagline: string | null

  @column()
  declare description: string | null

  @column()
  declare businessType: 'restaurant' | 'retail' | null

  /** Claves de FUNCIONES; se guarda como JSON en texto. */
  @column({
    prepare: (v: Funcion[]) => JSON.stringify((v ?? []).filter(esFuncion)),
    consume: (v: string | Funcion[] | null) => {
      if (Array.isArray(v)) return v.filter(esFuncion)
      try {
        const lista = JSON.parse(v ?? '[]')
        return Array.isArray(lista) ? lista.filter(esFuncion) : []
      } catch {
        return []
      }
    },
  })
  declare features: Funcion[]

  @column()
  declare isFeatured: boolean

  @column()
  declare isActive: boolean

  @column()
  declare sortOrder: number

  @hasMany(() => PlanPrice)
  declare prices: HasMany<typeof PlanPrice>

  @computed()
  get featureCount() {
    return this.features?.length ?? 0
  }

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
