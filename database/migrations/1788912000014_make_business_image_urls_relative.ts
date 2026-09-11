import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Quita el dominio a las URLs de `/media` ya guardadas.
 *
 * Antes se guardaban absolutas con `APP_URL`, así que las imágenes subidas en
 * local quedaban apuntando a `http://localhost:4599` y en producción salían
 * rotas. Ahora se guarda `/media/<key>` y la API le pone su propio dominio al
 * responder. Las URLs externas no se tocan.
 */
export default class extends BaseSchema {
  protected tableName = 'business_images'

  async up() {
    // `s{0,1}` y no `s?`: knex toma cualquier `?` del SQL crudo como binding.
    this.defer(async (db) => {
      await db.rawQuery(
        `UPDATE ${this.tableName}
            SET url = regexp_replace(url, '^https{0,1}://[^/]+(/media/businesses/)', '\\1')
          WHERE url ~ '^https{0,1}://[^/]+/media/businesses/'`
      )
    })
  }

  /** Sin vuelta atrás: no hay forma de saber qué dominio tenía cada fila. */
  async down() {}
}
