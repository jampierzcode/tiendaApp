import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import DiscountTarget from './discount_target.js'
import Product from './product.js'
import { DateTime } from 'luxon'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export type TipoPromo = 'percent' | 'fixed' | 'bundle'
/** `selection`: solo los destinos de `targets`. `category` y `product` son el formato anterior. */
export type AlcancePromo = 'all' | 'selection' | 'category' | 'product'

/**
 * Promoción de la tienda. Vive en la tabla `discounts` por historia: antes era
 * solo «un % por producto con fechas».
 */
export default class Discount extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  @column()
  declare name: string

  @column()
  declare kind: TipoPromo

  /** Porcentaje (`percent`) o monto que se descuenta por unidad (`fixed`). */
  @column()
  declare value: number

  /** `bundle`: lleva `buyQty` y paga `payQty` (2x1 → 2 y 1). */
  @column()
  declare buyQty: number | null

  @column()
  declare payQty: number | null

  @column()
  declare scope: AlcancePromo

  @column()
  declare productId: number | null

  @column()
  declare categoryId: number | null

  /** Con código es un cupón: solo aplica si el cliente lo escribe. */
  @column()
  declare code: string | null

  @column()
  declare isActive: boolean

  /** Sin fechas = sin vigencia (siempre). */
  @column.date()
  declare startDate: DateTime | null

  @column.date()
  declare endDate: DateTime | null

  /** Días en que aplica (1 = lunes … 7 = domingo), como «5,6». Vacío = todos los días. */
  @column()
  declare weekdays: string | null

  @hasMany(() => DiscountTarget)
  declare targets: HasMany<typeof DiscountTarget>

  /** Los días de la semana como números; [] = todos. */
  get dias(): number[] {
    return (this.weekdays ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  }

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
