import { defineConfig } from '@adonisjs/cors'
import env from '#start/env'

/**
 * Orígenes permitidos. Antes estaba en `origin: true`, que devuelve el
 * header con cualquier origen que pregunte; combinado con
 * `credentials: true` eso deja la API abierta a cualquier sitio.
 *
 * Se configura con CORS_ORIGINS en el .env, separado por comas:
 *   CORS_ORIGINS=http://localhost:5173,https://tienda.midominio.com
 */
const configurado = env.get('CORS_ORIGINS', 'http://localhost:5173').trim()

/**
 * `*` tiene que llegar como string, no dentro de una lista: el paquete
 * compara `allowedOrigins === '*'` y un `['*']` no casa con ningún origen,
 * así que bloquearía todo en vez de abrir todo. Con credenciales activas
 * devuelve el origen que preguntó, que es lo que exige la especificación.
 */
const allowedOrigins =
  configurado === '*'
    ? '*'
    : configurado
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)

const corsConfig = defineConfig({
  enabled: true,
  origin: allowedOrigins,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  exposeHeaders: [],
  credentials: true,
  maxAge: 90,
})

export default corsConfig
