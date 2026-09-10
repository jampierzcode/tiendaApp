import BusinessImage from '#models/business_image'
import StorageService from '#services/storage_service'
import type { HttpContext } from '@adonisjs/core/http'
import { readFile } from 'node:fs/promises'

export default class BusinessImagesController {
  public async index({ business, request }: HttpContext) {
    const type = request.input('type')

    const query = BusinessImage.query().where('business_id', business.id).orderBy('id', 'desc')

    if (type) {
      query.where('type', type)
    }

    return { status: 'success', data: await query }
  }

  public async store({ request, business }: HttpContext) {
    const data = request.only(['url', 'name', 'description', 'type', 'status'])

    const image = await BusinessImage.create({
      businessId: business.id,
      url: data.url,
      name: data.name ?? null,
      description: data.description ?? null,
      type: data.type ?? 'galeria',
      status: data.status ?? 'activo',
    })

    return { status: 'success', message: 'Imagen añadida', data: image }
  }

  /**
   * Sube una o varias imágenes al bucket y las registra en la galería.
   *
   * El archivo se valida aquí, no en el navegador: la validación del cliente
   * la salta cualquiera que llame la API directamente.
   */
  public async upload({ request, business, response }: HttpContext) {
    const archivos = request.files('images', {
      size: `${StorageService.tamanoMaximoMb}mb`,
      extnames: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    })

    if (!archivos.length) {
      return response.unprocessableEntity({
        status: 'error',
        message: 'No se recibió ninguna imagen',
      })
    }

    const tipo = request.input('type', 'producto')
    const creadas: BusinessImage[] = []
    const rechazadas: string[] = []

    for (const archivo of archivos) {
      if (!archivo.isValid) {
        rechazadas.push(`${archivo.clientName}: ${archivo.errors[0]?.message ?? 'archivo inválido'}`)
        continue
      }

      if (!StorageService.tiposPermitidos.includes(archivo.headers['content-type'] ?? '')) {
        rechazadas.push(`${archivo.clientName}: formato no permitido`)
        continue
      }

      const contenido = await readFile(archivo.tmpPath!)
      const key = StorageService.construirKey(
        business.id,
        archivo.clientName,
        archivo.extname ?? 'jpg'
      )

      const url = await StorageService.subir(key, contenido, archivo.headers['content-type']!)

      creadas.push(
        await BusinessImage.create({
          businessId: business.id,
          url,
          storageKey: key,
          sizeBytes: archivo.size,
          contentType: archivo.headers['content-type'],
          name: archivo.clientName,
          type: tipo,
          status: 'activo',
        })
      )
    }

    if (!creadas.length) {
      return response.unprocessableEntity({
        status: 'error',
        message: rechazadas.join(' · ') || 'No se pudo subir ninguna imagen',
      })
    }

    return response.created({
      status: 'success',
      message: `${creadas.length} ${creadas.length === 1 ? 'imagen subida' : 'imágenes subidas'}`,
      data: creadas,
      rechazadas,
    })
  }

  public async update({ params, request, business }: HttpContext) {
    const image = await BusinessImage.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    image.merge(request.only(['name', 'description', 'type', 'status']))
    await image.save()

    return { status: 'success', message: 'Imagen actualizada', data: image }
  }

  public async destroy({ params, business, response }: HttpContext) {
    const image = await BusinessImage.query()
      .where('id', params.id)
      .andWhere('business_id', business.id)
      .firstOrFail()

    // Primero el bucket: si falla, la fila sigue ahí y se puede reintentar.
    // Al revés quedaría el archivo huérfano ocupando espacio para siempre.
    if (image.storageKey) {
      try {
        await StorageService.eliminar(image.storageKey)
      } catch (error) {
        return response.internalServerError({
          status: 'error',
          message: 'No se pudo borrar el archivo del bucket. Intenta de nuevo.',
        })
      }
    }

    await image.delete()

    return { status: 'success', message: 'Imagen eliminada' }
  }
}
