import StorageService from '#services/storage_service'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Sirve las imágenes del bucket.
 *
 * El bucket es privado y el proveedor no admite abrirlo por API, así que el
 * servidor hace de puente: lee con sus credenciales y entrega el archivo con
 * caché larga. La URL resultante es fija, sin token y no caduca, que es lo
 * que necesita una foto de producto que va a circular por WhatsApp.
 */
export default class MediaController {
  public async show({ params, response }: HttpContext) {
    const key = Array.isArray(params['*']) ? params['*'].join('/') : String(params['*'] ?? '')

    if (!StorageService.keyValida(key)) {
      return response.notFound({ status: 'error', message: 'Imagen no encontrada' })
    }

    try {
      const archivo = await StorageService.leer(key)

      // La clave lleva un uuid, así que el contenido de una URL nunca cambia:
      // se puede cachear para siempre.
      response.header('Cache-Control', 'public, max-age=31536000, immutable')
      response.header('Content-Type', archivo.contentType)
      if (archivo.etag) response.header('ETag', archivo.etag)
      if (archivo.contentLength) response.header('Content-Length', String(archivo.contentLength))

      return response.stream(archivo.cuerpo)
    } catch (error) {
      return response.notFound({ status: 'error', message: 'Imagen no encontrada' })
    }
  }
}
