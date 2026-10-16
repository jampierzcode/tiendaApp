import { BaseModel, column, computed, hasMany, belongsTo, beforeCreate } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
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

  /** 'retail' (ropa, repuestos…) o 'restaurant' (menú digital). */
  @column()
  declare businessType: 'retail' | 'restaurant'

  /** Cuándo se exige cobrar: 'none' | 'on_confirm' (adelantado) | 'on_delivery' (contra entrega). */
  @column()
  declare paymentPolicy: 'none' | 'on_confirm' | 'on_delivery'

  /** Texto libre para el cliente: a qué Yape o cuenta pagar. */
  @column()
  declare paymentInstructions: string | null

  /** JSON con plantillas de WhatsApp por evento; null usa las de fábrica. */
  @column()
  declare notificationTemplates: string | null

  // --- Suscripción ---

  /** 'trial' (prueba gratis), 'active' (pagando) o 'expired'. */
  @column()
  declare subscriptionStatus: 'trial' | 'active' | 'expired'

  @column.dateTime()
  declare trialEndsAt: DateTime | null

  /** Plan contratado (texto libre del superadmin: "Mensual", "Anual"…). */
  @column()
  declare plan: string | null

  /** Hasta cuándo está pagado. Null = sin vencimiento. */
  @column.dateTime()
  declare paidUntil: DateTime | null

  /** polleria, cafeteria, cevicheria, comida_rapida, ropa, repuestos… Solo informativo. */
  @column()
  declare businessSubtype: string | null

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

  get esRestaurante() {
    return this.businessType === 'restaurant'
  }

  /** ¿Descuenta inventario? Un restaurante vende platos, no unidades en góndola. */
  get controlaStock() {
    return !this.esRestaurante
  }

  /**
   * Estado real hoy: el guardado en BD puede estar desfasado respecto al
   * calendario (una prueba o un pago vencen solos, sin que nadie edite la fila).
   */
  @computed()
  get effectiveSubscriptionStatus(): 'trial' | 'active' | 'expired' {
    if (this.subscriptionStatus === 'expired') return 'expired'
    const now = DateTime.now()
    if (this.subscriptionStatus === 'trial') {
      return this.trialEndsAt && this.trialEndsAt < now ? 'expired' : 'trial'
    }
    return this.paidUntil && this.paidUntil < now ? 'expired' : 'active'
  }

  /** Sin plan vigente: el panel queda en solo lectura y la tienda no vende. */
  get subscriptionExpired() {
    return this.effectiveSubscriptionStatus === 'expired'
  }

  /** Días que le quedan a la prueba; null si no está en prueba. */
  @computed()
  get trialDaysLeft() {
    if (this.subscriptionStatus !== 'trial' || !this.trialEndsAt) return null
    return Math.max(0, Math.ceil(this.trialEndsAt.diffNow('days').days))
  }

  /** Días hasta el vencimiento (de la prueba o del pago); null si no vence. */
  @computed()
  get subscriptionDaysLeft() {
    const fin = this.subscriptionStatus === 'trial' ? this.trialEndsAt : this.paidUntil
    if (!fin) return null
    return Math.ceil(fin.diffNow('days').days)
  }

  /** ¿Está lista para recibir pedidos? */
  get puedeVender() {
    return (
      this.isPublic &&
      this.status === 'activo' &&
      !this.subscriptionExpired &&
      Boolean(this.whatsappPhone)
    )
  }
}
