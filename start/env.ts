/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Origenes permitidos por CORS, separados por comas
  |----------------------------------------------------------
  */
  CORS_ORIGINS: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Almacenamiento de imágenes (bucket S3-compatible)
  |----------------------------------------------------------
  */
  S3_ENDPOINT: Env.schema.string(),
  S3_REGION: Env.schema.string.optional(),
  S3_BUCKET: Env.schema.string(),
  S3_ACCESS_KEY_ID: Env.schema.string(),
  S3_SECRET_ACCESS_KEY: Env.schema.string(),
  /** Dominio público del bucket, si lo abres desde el panel del proveedor. */
  S3_PUBLIC_URL: Env.schema.string.optional(),
  /** Zona horaria en la que se agrupan los reportes. */
  REPORTS_TIMEZONE: Env.schema.string.optional(),
})
