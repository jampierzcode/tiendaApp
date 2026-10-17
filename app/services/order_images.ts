import type OrderItem from '#models/order_item'
import ProductVariation from '#models/product_variation'
import Product from '#models/product'

/**
 * Foto de cada línea de un pedido: la de la variación si tiene, si no la del
 * producto. Sin foto devuelve null y la pantalla muestra un recuadro neutro.
 */
export default class OrderImages {
  static async deItems(items: OrderItem[]): Promise<Map<number, string | null>> {
    const resultado = new Map<number, string | null>()
    const variaciones = [...new Set(items.map((i) => i.productVariationId).filter((x): x is number => !!x))]
    const productos = [...new Set(items.map((i) => i.productId).filter((x): x is number => !!x))]

    const vs = variaciones.length
      ? await ProductVariation.query().whereIn('id', variaciones).preload('businessImage')
      : []
    const ps = productos.length
      ? await Product.query().whereIn('id', productos).preload('businessImages')
      : []
    const porVariacion = new Map(vs.map((v) => [v.id, v.businessImage?.url ?? null]))
    const porProducto = new Map(ps.map((p) => [p.id, p.businessImages?.url ?? null]))

    for (const i of items) {
      const url =
        (i.productVariationId ? porVariacion.get(i.productVariationId) : null) ??
        (i.productId ? porProducto.get(i.productId) : null) ??
        null
      resultado.set(i.id, url)
    }
    return resultado
  }

  /** Serializa pedidos agregando `imageUrl` a cada línea. */
  static async serializar(pedidos: import('#models/order').default[]) {
    const todos = pedidos.flatMap((p) => p.items ?? [])
    const mapa = await this.deItems(todos)
    return pedidos.map((p) => {
      const json = p.serialize()
      json.items = (p.items ?? []).map((i) => ({ ...i.serialize(), imageUrl: mapa.get(i.id) ?? null }))
      return json
    })
  }
}
