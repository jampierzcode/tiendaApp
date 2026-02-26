import { BaseModel, column, hasMany, belongsTo } from '@adonisjs/lucid/orm'
import Product from './product.js'
import User from './user.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class Business extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare uuid: string

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
  declare logoUrl: string | null

  @column()
  declare status: 'activo' | 'inactivo'

  @column({ columnName: 'user_id' })
  declare userId: number

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => Product)
  declare products: HasMany<typeof Product>
}
