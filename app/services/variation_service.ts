import type Business from '#models/business'
import type Product from '#models/product'
import ProductAttributeValue from '#models/product_attribute_value'
import ProductVariation from '#models/product_variation'
import ProductVariationAttribute from '#models/product_variation_attribute'
import InventoryService from '#services/inventory_service'
import SkuService from '#services/sku_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export class VariationError extends Error {}

export interface NuevaVariacion {
  attributeValueIds: number[]
  sku?: string | null
  /** Si no viene, usa el precio base del producto: es la referencia. */
  price?: number | null
  cost?: number | null
  weight?: number | null
  /** Mínimo propio; si no viene se usa el del producto. */
  lowStockThreshold?: number | null
  businessImageId?: number | null
  /** Stock de apertura (kardex `inicial`). En compras va en 0: entra al recibir. */
  stock?: number
}

/**
 * Altas de variaciones y paso de producto simple a producto con tallas.
 *
 * Un producto simple guarda su stock en una variación oculta (`is_default`).
 * Cuando aparece la primera variación con atributos, ese stock se traslada a
 * ella por el kardex (salida + entrada con la misma referencia) y la oculta
 * queda en cero. Como el traslado deja la oculta vacía, repetirlo no mueve ni
 * duplica nada.
 */
export default class VariationService {
  /**
   * Variación oculta que ya no representa al producto porque este tiene
   * variaciones con atributos. Se usa en consultas sobre `product_variations`.
   */
  static readonly SQL_DEFAULT_RETIRADA = `(product_variations.is_default = true AND EXISTS (
    SELECT 1 FROM product_variations s
      JOIN product_variation_attributes a ON a.variation_id = s.id
     WHERE s.product_id = product_variations.product_id))`

  /** Misma regla, en memoria, sobre variaciones con sus atributos cargados. */
  static visibles<T extends { isDefault: boolean; attributes?: unknown[] }>(variations: T[]) {
    const conAtributos = variations.some((v) => !v.isDefault && (v.attributes?.length ?? 0) > 0)
    return conAtributos ? variations.filter((v) => !v.isDefault) : variations
  }

  static async crear(
    business: Business,
    product: Product,
    datos: NuevaVariacion,
    userId: number | null,
    trx?: TransactionClientContract
  ) {
    const run = async (t: TransactionClientContract) => {
      const valueIds = [...new Set((datos.attributeValueIds ?? []).map(Number).filter(Boolean))]
      if (!valueIds.length) {
        throw new VariationError('Elige al menos un atributo (talla, color…) para la variación')
      }

      // Solo valores de este negocio: si no, se etiquetaría con los de otra tienda.
      const valores = await ProductAttributeValue.query({ client: t })
        .where('business_id', business.id)
        .whereIn('id', valueIds)
      if (valores.length !== valueIds.length) {
        throw new VariationError('Algún atributo elegido no pertenece a esta tienda')
      }

      // Misma combinación dos veces es duplicar la variación.
      const clave = [...valueIds].sort((a, b) => a - b).join('-')
      const existentes = await ProductVariationAttribute.query({ client: t })
        .where('business_id', business.id)
        .whereIn(
          'variation_id',
          ProductVariation.query({ client: t }).where('product_id', product.id).select('id')
        )
      const porVariacion = new Map<number, number[]>()
      for (const a of existentes) {
        porVariacion.set(a.variationId, [...(porVariacion.get(a.variationId) ?? []), a.attributeValueId])
      }
      for (const ids of porVariacion.values()) {
        if (ids.sort((a, b) => a - b).join('-') === clave) {
          throw new VariationError('Ya existe una variación con esa combinación')
        }
      }

      const variation = await ProductVariation.create(
        {
          businessId: business.id,
          productId: product.id,
          sku:
            datos.sku?.trim() ||
            (await SkuService.sugerirVariacion(
              business.id,
              product.sku,
              valores
                .sort((a, b) => valueIds.indexOf(a.id) - valueIds.indexOf(b.id))
                .map((v) => v.value),
              product.name
            )),
          isDefault: false,
          lowStockThreshold: datos.lowStockThreshold ?? null,
          price: datos.price ?? Number(product.price),
          cost: datos.cost ?? null,
          stock: 0,
          weight: datos.weight ?? null,
          businessImageId: datos.businessImageId ?? null,
        },
        { client: t }
      )

      await ProductVariationAttribute.createMany(
        valueIds.map((id) => ({
          businessId: business.id,
          variationId: variation.id,
          attributeValueId: id,
        })),
        { client: t }
      )

      await this.migrarStockSimple(business.id, product.id, variation.id, userId, t)

      const apertura = Number(datos.stock ?? 0)
      if (apertura !== 0) {
        await InventoryService.applyMovement({
          businessId: business.id,
          variationId: variation.id,
          type: 'inicial',
          quantity: apertura,
          unitCost: datos.cost ?? null,
          note: 'Stock inicial al crear la variación',
          userId,
          trx: t,
        })
      }

      await variation.refresh()
      return variation
    }

    return trx ? run(trx) : db.transaction(run)
  }

  /**
   * Pasa el stock de la variación oculta a `destinoId` (la primera con
   * atributos). No hace nada si el producto ya no es simple, si la oculta está
   * vacía o si el destino es la propia oculta.
   */
  static async migrarStockSimple(
    businessId: number,
    productId: number,
    destinoId: number,
    userId: number | null,
    trx: TransactionClientContract
  ) {
    const oculta = await ProductVariation.query({ client: trx })
      .where('business_id', businessId)
      .andWhere('product_id', productId)
      .andWhere('is_default', true)
      .forUpdate()
      .first()

    if (!oculta || oculta.id === destinoId || oculta.stock === 0) return 0

    const cantidad = oculta.stock

    await InventoryService.applyMovement({
      businessId,
      variationId: oculta.id,
      type: 'ajuste',
      quantity: -cantidad,
      unitCost: oculta.cost,
      referenceType: 'variation_migration',
      referenceId: destinoId,
      note: 'Traslado: el producto ahora tiene variaciones',
      userId,
      trx,
    })
    await InventoryService.applyMovement({
      businessId,
      variationId: destinoId,
      type: 'ajuste',
      quantity: cantidad,
      unitCost: oculta.cost,
      referenceType: 'variation_migration',
      referenceId: oculta.id,
      note: 'Traslado: stock del producto antes de tener variaciones',
      userId,
      trx,
    })

    return cantidad
  }

  /**
   * Llamado cuando se sincronizan los atributos de una variación (flujo en dos
   * pasos del editor): si quedó con atributos, dispara el traslado.
   */
  static async alAsignarAtributos(
    businessId: number,
    variation: ProductVariation,
    userId: number | null
  ) {
    if (variation.isDefault) return 0

    return db.transaction(async (trx) => {
      const total = await trx
        .from('product_variation_attributes')
        .where('variation_id', variation.id)
        .count('* as total')
        .first()
      if (Number(total?.total ?? 0) === 0) return 0

      return this.migrarStockSimple(businessId, variation.productId, variation.id, userId, trx)
    })
  }
}
