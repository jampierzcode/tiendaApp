import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Ingredient from '#models/ingredient'

export default class RecipeLine extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare recipeId: number

  @column()
  declare ingredientId: number

  /** En la unidad del insumo. */
  @column()
  declare quantity: number

  /** 0-100. */
  @column()
  declare wastePercent: number

  @belongsTo(() => Ingredient)
  declare ingredient: BelongsTo<typeof Ingredient>
}
