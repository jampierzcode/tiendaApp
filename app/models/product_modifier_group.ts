import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ModifierGroup from '#models/modifier_group'
import Product from '#models/product'

/** Un grupo ofrecido en un plato: cuántas opciones se pueden/deben elegir. */
export default class ProductModifierGroup extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare productId: number

  @column()
  declare modifierGroupId: number

  /** 1 o más = obligatorio. */
  @column()
  declare minSelect: number

  @column()
  declare maxSelect: number

  @column()
  declare sortOrder: number

  @belongsTo(() => ModifierGroup)
  declare group: BelongsTo<typeof ModifierGroup>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
