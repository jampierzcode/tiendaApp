import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Suscripción con prueba gratis.
 *
 * `subscription_status` arranca en 'active' para todo lo que ya existe: solo
 * los negocios creados por el wizard nacen en 'trial' con `trial_ends_at`.
 *
 * También se quita el UNIQUE de `users.name`: era el hallazgo pendiente de la
 * entrega 1 y el wizard lo haría estallar con el primer "Juan Pérez" repetido.
 * El correo sigue siendo el identificador único.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('businesses', (table) => {
      table.string('subscription_status', 20).notNullable().defaultTo('active') // trial | active | expired
      table.timestamp('trial_ends_at').nullable()
      table.string('business_subtype', 40).nullable() // polleria, cafeteria, ropa…
    })

    this.schema.alterTable('users', (table) => {
      table.dropUnique(['name'], 'users_name_unique')
    })
  }

  async down() {
    this.schema.alterTable('businesses', (table) => {
      table.dropColumn('subscription_status')
      table.dropColumn('trial_ends_at')
      table.dropColumn('business_subtype')
    })
  }
}
