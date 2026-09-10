import { BaseModel, column, hasMany, belongsTo, beforeCreate } from '@adonisjs/lucid/orm'
import Product from './product.js'
import User from './user.js'
import BusinessImage from './business_image.js'
import Order from './order.js'
import Customer from './customer.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import SlugService from '#services/slug_service'

export default class Business extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare uuid: string

  /** Dirección pública de la tienda: /t/modas-lima */
  @column()
  declare slug: string

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
  declare logoUrl: string | null

  @column()
  declare status: 'activo' | 'inactivo'

  // --- Pedidos por WhatsApp ---

  /** Número al que llegan los pedidos, en formato internacional sin signos. */
  @column()
  declare whatsappPhone: string | null

  /**
   * Plantilla del mensaje. Admite {{codigo}}, {{cliente}}, {{productos}},
   * {{total}}, {{entrega}} y {{nota}}.
   */
  @column()
  declare whatsappMessageTemplate: string | null

  // --- Contacto ---

  @column()
  declare phone: string | null

  @column()
  declare email: string | null

  @column()
  declare address: string | null

  @column()
  declare city: string | null

  @column()
  declare instagram: string | null

  @column()
  declare facebook: string | null

  @column()
  declare tiktok: string | null

  @column()
  declare schedule: string | null

  // --- Identidad visual de la tienda pública ---

  @column()
  declare primaryColor: string

  @column()
  declare secondaryColor: string

  @column()
  declare bannerImageId: number | null

  // --- Comercio ---

  @column()
  declare currency: string

  @column()
  declare currencySymbol: string

  @column()
  declare shippingCost: number

  /** A partir de este monto el envío es gratis. Null = nunca. */
  @column()
  declare freeShippingFrom: number | null

  /** La tienda pública solo responde si está encendida. */
  @column()
  declare isPublic: boolean

  @column({ columnName: 'user_id' })
  declare userId: number

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => BusinessImage, { foreignKey: 'bannerImageId' })
  declare bannerImage: BelongsTo<typeof BusinessImage>

  @hasMany(() => Product)
  declare products: HasMany<typeof Product>

  @hasMany(() => Order)
  declare orders: HasMany<typeof Order>

  @hasMany(() => Customer)
  declare customers: HasMany<typeof Customer>

  /**
   * El slug es obligatorio y único en toda la base, pero nadie debería tener
   * que pensarlo al crear un negocio: se deriva del nombre.
   */
  @beforeCreate()
  static async asignarSlug(business: Business) {
    if (!business.slug) {
      business.slug = await SlugService.uniqueSlugGlobal('businesses', business.name)
    }
  }

  /** ¿Está lista para recibir pedidos? */
  get puedeVender() {
    return this.isPublic && this.status === 'activo' && Boolean(this.whatsappPhone)
  }
}
