import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'
import pg from 'pg'

/**
 * node-pg devuelve NUMERIC y BIGINT como texto, para no perder precisión en
 * números que no caben en un double de JavaScript.
 *
 * Para esta aplicación eso significaría que `price` llegara como "39.90" en
 * vez de 39.9 y que todo `COUNT(*)` fuera un string: los precios se
 * concatenarían en lugar de sumarse. Nuestros importes son soles con dos
 * decimales y los conteos son pequeños, así que los convertimos a número.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) =>
  value === null ? null : Number(value)
)
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => (value === null ? null : Number(value)))

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
