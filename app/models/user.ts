import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'

import Role from './role.js'

import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Business from './business.js'

// import { BelongsTo } from '@adonisjs/lucid/types/relations'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  static table = 'users'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare email: string

  @column.dateTime({ columnName: 'email_verified_at' })
  declare emailVerifiedAt: DateTime | null

  @column({ serializeAs: null }) // ⛔ No se enviará en las respuestas JSON
  declare password: string

  @column({ columnName: 'rol_id' })
  declare rolId: number | null

  @belongsTo(() => Role, { foreignKey: 'rolId' })
  declare role: BelongsTo<typeof Role>

  @hasMany(() => Business, { foreignKey: 'userId' })
  declare businesses: HasMany<typeof Business>

  @column()
  declare status: 'activo' | 'inactivo'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  static accessTokens = DbAccessTokensProvider.forModel(User)
}
