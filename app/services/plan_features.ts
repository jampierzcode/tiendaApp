/**
 * Catálogo de funciones que un plan puede incluir.
 *
 * Es la única fuente de verdad: el superadmin marca estas claves en cada plan,
 * el middleware `funcion` bloquea las rutas del panel que no correspondan y el
 * front recibe la lista para esconder o poner candado en el menú.
 *
 * Un negocio SIN plan asignado (los que existían antes de los planes) tiene
 * todas las funciones: así nadie pierde nada el día que esto se despliega.
 */

type Rubro = 'restaurant' | 'retail' | null

/** `rubro`: a qué tipo de negocio aplica (null = a los dos). Solo sirve para mostrarla o no. */
export const FUNCIONES = {
  carta: {
    label: 'Carta o catálogo digital',
    detalle: 'Platos o productos con fotos, categorías, tallas, colores y extras.',
    rubro: null as Rubro,
  },
  qr: {
    label: 'QR y link propio',
    detalle: 'Póster con QR y tu link para redes.',
    rubro: null as Rubro,
  },
  promociones: {
    label: 'Promociones y cupones',
    detalle: 'Descuentos, 2x1 y cupones.',
    rubro: null as Rubro,
  },
  inventario: {
    label: 'Inventario y stock',
    detalle: 'Stock por talla y color, movimientos y alertas de stock bajo.',
    rubro: 'retail' as Rubro,
  },
  pedidos_online: {
    label: 'Pedidos en línea',
    detalle: 'Panel de pedidos, comprobantes Yape/Plin y clientes.',
    rubro: null as Rubro,
  },
  envios: {
    label: 'Envíos y delivery',
    detalle: 'Zonas y costo de envío, guías, etiquetas y seguimiento.',
    rubro: null as Rubro,
  },
  cocina: {
    label: 'Pantalla de cocina',
    detalle: 'Aceptar → cocina → listo → entregado.',
    rubro: 'restaurant' as Rubro,
  },
  cuentas_cliente: {
    label: 'App del cliente',
    detalle: 'Tu cliente sigue su pedido y guarda su cuenta.',
    rubro: null as Rubro,
  },
  pos: {
    label: 'Caja / mostrador',
    detalle: 'Vende en el local desde el mismo panel.',
    rubro: null as Rubro,
  },
  reportes: {
    label: 'Reportes de ventas',
    detalle: 'Ventas, productos top y tendencias.',
    rubro: null as Rubro,
  },
  whatsapp: {
    label: 'WhatsApp conectado',
    detalle: 'Bandeja de mensajes y avisos automáticos del estado del pedido.',
    rubro: null as Rubro,
  },
  vendedor_ia: {
    label: 'Vendedor IA 24/7',
    detalle: 'Responde y toma pedidos por WhatsApp.',
    rubro: null as Rubro,
  },
  insumos: {
    label: 'Insumos y recetas',
    detalle: 'Costo por plato y descuento de inventario.',
    rubro: 'restaurant' as Rubro,
  },
  compras: {
    label: 'Compras y proveedores',
    detalle: 'Órdenes de compra, costos, márgenes y sugerencias de precio.',
    rubro: 'retail' as Rubro,
  },
} as const

export type Funcion = keyof typeof FUNCIONES

export const TODAS_LAS_FUNCIONES = Object.keys(FUNCIONES) as Funcion[]

export function esFuncion(valor: unknown): valor is Funcion {
  return typeof valor === 'string' && valor in FUNCIONES
}

/**
 * Qué función exige cada ruta del panel (`/api/b/:uuid/<recurso>/...`).
 * Se evalúa en orden: la primera regla que calce gana. Lo que no aparece
 * aquí (platos, categorías, galería, ajustes de la tienda…) es parte de la
 * carta y lo tiene cualquier plan.
 */
export const REGLAS_RUTA: { patron: RegExp; funcion: Funcion }[] = [
  { patron: /^products\/\d+\/recipe/, funcion: 'insumos' },
  { patron: /^(ingredients|recipes)(\/|$)/, funcion: 'insumos' },
  { patron: /^discounts(\/|$)/, funcion: 'promociones' },
  { patron: /^seller-config(\/|$)/, funcion: 'vendedor_ia' },
  { patron: /^whatsapp\/(agent|seller-config)/, funcion: 'vendedor_ia' },
  { patron: /^whatsapp(\/|$)/, funcion: 'whatsapp' },
  { patron: /^pos(\/|$)/, funcion: 'pos' },
  { patron: /^inventory(\/|$)/, funcion: 'inventario' },
  { patron: /^(purchases|suppliers|returns|price-reviews)(\/|$)/, funcion: 'compras' },
  { patron: /^products\/\d+\/(price-suggestion|price)(\/|$)/, funcion: 'compras' },
  { patron: /^shipments(\/|$)/, funcion: 'envios' },
  { patron: /^reports(\/|$)/, funcion: 'reportes' },
  {
    patron: /^(orders|customers|payments|payment-proofs)(\/|$)/,
    funcion: 'pedidos_online',
  },
]

export function funcionDeRuta(recurso: string): Funcion | null {
  return REGLAS_RUTA.find((r) => r.patron.test(recurso))?.funcion ?? null
}
