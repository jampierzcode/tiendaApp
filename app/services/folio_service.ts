import type Business from '#models/business'
import type Order from '#models/order'
import { OrderError } from '#services/order_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Folios de cuenta.
 *
 * Cada caja usa una serie (A, B…); varias cajas pueden compartir la misma.
 * El folio se toma al imprimir la cuenta por primera vez (o al cobrar si
 * nunca se imprimió) y no cambia en las reimpresiones.
 *
 * Concurrencia: dentro de la transacción se bloquea primero la cuenta y
 * después se hace `UPDATE … SET next_number = next_number + 1 RETURNING`
 * sobre la serie. Ese UPDATE bloquea la fila de la serie, así que dos cajas
 * que imprimen a la vez se ponen en fila y nunca sacan el mismo número; si
 * la transacción falla, el número no se consume (no quedan huecos).
 */
export default class FolioService {
  /** Serie por defecto del negocio; si no hay ninguna se crea la "A". */
  static async seriePorDefecto(business: Business, trx?: TransactionClientContract) {
    const cliente = trx ?? db
    const primera = await cliente
      .from('folio_series')
      .where('business_id', business.id)
      .andWhere('is_active', true)
      .orderBy('id', 'asc')
      .first()
    if (primera) return primera
    await db.rawQuery(
      `INSERT INTO folio_series (business_id, code, name, next_number, is_active, created_at, updated_at)
       VALUES (?, 'A', 'Serie A', 1, true, NOW(), NOW()) ON CONFLICT (business_id, code) DO NOTHING`,
      [business.id]
    )
    return cliente.from('folio_series').where('business_id', business.id).andWhere('code', 'A').first()
  }

  /** Serie de una caja: la suya, o la por defecto si no tiene. */
  static async serieDeCaja(business: Business, cashRegisterId: number | null, trx: TransactionClientContract) {
    if (cashRegisterId) {
      const caja = await trx.from('cash_registers').where('id', cashRegisterId).select('folio_series_id').first()
      if (caja?.folio_series_id) {
        const s = await trx.from('folio_series').where('id', caja.folio_series_id).andWhere('is_active', true).first()
        if (s) return s
      }
    }
    return this.seriePorDefecto(business, trx)
  }

  /**
   * Asigna folio a la cuenta si aún no tiene. La cuenta ya debe estar
   * bloqueada (FOR UPDATE) por quien llama.
   */
  static async asignar(business: Business, order: Order, cashRegisterId: number | null, trx: TransactionClientContract) {
    if (order.folioNumber) return { serie: order.folioSeries!, numero: order.folioNumber }
    const serie = await this.serieDeCaja(business, cashRegisterId, trx)
    if (!serie) throw new OrderError('No hay serie de folios activa')
    const filas = await trx.rawQuery(
      'UPDATE folio_series SET next_number = next_number + 1, updated_at = NOW() WHERE id = ? RETURNING next_number - 1 AS numero, code',
      [serie.id]
    )
    const fila = filas.rows[0]
    order.folioSeries = fila.code
    order.folioNumber = Number(fila.numero)
    order.documentSeries = fila.code
    order.documentNumber = Number(fila.numero)
    return { serie: fila.code as string, numero: Number(fila.numero) }
  }

  static texto(serie: string | null, numero: number | null) {
    return numero ? `${serie}-${String(numero).padStart(6, '0')}` : null
  }
}
