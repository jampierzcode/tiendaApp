import env from '#start/env'
import { HttpContext } from '@adonisjs/core/http'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

/**
 * Almacenamiento de imágenes en el bucket S3-compatible.
 *
 * El bucket es privado y el proveedor no admite ACL ni políticas de bucket
 * (responde `NotImplemented`), así que un enlace directo al objeto devuelve
 * 403. Tampoco sirven las URLs firmadas: caducan, y una foto de producto que
 * deja de verse a los quince minutos no es una foto de producto.
 *
 * Por eso las imágenes se sirven a través de `/media/<key>`: el servidor lee
 * del bucket con sus credenciales y devuelve el archivo con caché larga. La
 * URL es estable, sin token y no caduca.
 *
 * Si algún día abres el bucket al público desde el panel del proveedor, basta
 * con poner `S3_PUBLIC_URL` en el .env y las URLs pasan a apuntar directo al
 * bucket, sin tocar ni una línea de código.
 */
export default class StorageService {
  private static cliente: S3Client | null = null

  static get bucket() {
    return env.get('S3_BUCKET')
  }

  private static get s3() {
    if (!this.cliente) {
      this.cliente = new S3Client({
        endpoint: env.get('S3_ENDPOINT'),
        region: env.get('S3_REGION', 'auto'),
        credentials: {
          accessKeyId: env.get('S3_ACCESS_KEY_ID'),
          secretAccessKey: env.get('S3_SECRET_ACCESS_KEY'),
        },
        forcePathStyle: true,
      })
    }
    return this.cliente
  }

  /** Tipos aceptados. Nada de SVG: admite scripts. */
  static readonly tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  static readonly tamanoMaximoMb = 8

  /**
   * Clave del objeto. Lleva el id del negocio delante para que las imágenes
   * queden separadas por tienda, y un uuid para que subir dos veces la misma
   * foto no sobrescriba la anterior.
   */
  static construirKey(businessId: number, nombreOriginal: string, extension: string) {
    const base = nombreOriginal
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)

    return `businesses/${businessId}/${base || 'imagen'}-${randomUUID().slice(0, 8)}.${extension}`
  }

  static async subir(key: string, contenido: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: contenido,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )

    return this.urlPublica(key)
  }

  static async eliminar(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  /** Lee el objeto para servirlo desde `/media`. */
  static async leer(key: string) {
    const salida = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    )

    return {
      cuerpo: salida.Body as Readable,
      contentType: salida.ContentType ?? 'application/octet-stream',
      contentLength: salida.ContentLength,
      etag: salida.ETag,
    }
  }

  /**
   * Lo que se guarda en la base. Directa al bucket si está abierto, y si no,
   * la ruta relativa `/media/<key>`: sin dominio, porque la API no tiene por
   * qué saber en qué dominio vive. El mismo registro sirve en local y en
   * producción.
   */
  static urlPublica(key: string) {
    const dominioPublico = env.get('S3_PUBLIC_URL')

    if (dominioPublico) {
      return `${dominioPublico.replace(/\/$/, '')}/${key}`
    }

    return `/media/${key}`
  }

  /**
   * Completa una ruta relativa con el origen del request en curso, que es el
   * dominio por el que el cliente llegó a esta API. Las URLs externas pasan
   * tal cual. Fuera de un request (comandos, seeders) la deja relativa.
   */
  static urlAbsoluta(url: string | null) {
    if (!url?.startsWith('/')) return url

    const ctx = HttpContext.get()
    if (!ctx) return url

    return `${ctx.request.protocol()}://${ctx.request.host()}${url}`
  }

  /** Inverso de `urlAbsoluta`: quita el origen a nuestras rutas de `/media`. */
  static urlRelativa(url: string | null) {
    return url?.replace(/^https?:\/\/[^/]+(?=\/media\/businesses\/)/, '') ?? url
  }

  /**
   * Solo se sirven claves con la forma que genera `construirKey`. Corta de
   * raíz que alguien pida por `/media` cualquier otra cosa del bucket.
   */
  static keyValida(key: string) {
    return /^businesses\/\d+\/[A-Za-z0-9._-]+$/.test(key)
  }
}
