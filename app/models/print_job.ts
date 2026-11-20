import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type PrintKind = 'comanda' | 'anulacion' | 'precuenta' | 'nota_venta' | 'prueba'

/**
 * Trabajo de impresión. El backend arma el contenido (payload) y la central
 * del local lo convierte a ESC/POS y lo manda a la impresora.
 */
export default class PrintJob extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare businessId: number

  /** Null = impresora de caja. */
  @column()
  declare printerId: number | null

  @column()
  declare orderId: number | null

  @column()
  declare kind: PrintKind

  @column({
    prepare: (v: unknown) => JSON.stringify(v ?? {}),
    consume: (v: string) => {
      try {
        return JSON.parse(v)
      } catch {
        return {}
      }
    },
  })
  declare payload: Record<string, any>

  @column()
  declare status: 'pendiente' | 'impreso' | 'error'

  @column()
  declare attempts: number

  @column()
  declare error: string | null

  @column.dateTime()
  declare printedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
