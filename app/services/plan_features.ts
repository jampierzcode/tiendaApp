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

export const FUNCIONES = {
  carta: { label: 'Carta digital', detalle: 'Platos con fotos, categorías, cremas y extras.' },
  qr: { label: 'QR y link propio', detalle: 'Póster con QR para mesas y tu link para redes.' },
  promociones: { label: 'Promociones y cupones', detalle: 'Descuentos, 2x1 y cupones.' },
  pedidos_online: {
    label: 'Pedidos en línea',
    detalle: 'Panel de pedidos, delivery, comprobantes Yape/Plin y clientes.',
  },
  cocina: { label: 'Pantalla de cocina', detalle: 'Aceptar → cocina → listo → entregado.' },
  cuentas_cliente: {
    label: 'App del cliente',
    detalle: 'Tu cliente sigue su pedido y guarda su cuenta.',
  },
  pos: { label: 'Caja / mostrador', detalle: 'Vende en el local desde el mismo panel.' },
  reportes: { label: 'Reportes de ventas', detalle: 'Ventas, platos top y tendencias.' },
  whatsapp: {
    label: 'WhatsApp conectado',
    detalle: 'Bandeja de mensajes y avisos automáticos del estado del pedido.',
  },
  vendedor_ia: { label: 'Vendedor IA 24/7', detalle: 'Responde y toma pedidos por WhatsApp.' },
  insumos: { label: 'Insumos y recetas', detalle: 'Costo por plato y descuento de inventario.' },
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
  { patron: /^reports(\/|$)/, funcion: 'reportes' },
  {
    patron: /^(orders|customers|shipments|payments|payment-proofs)(\/|$)/,
    funcion: 'pedidos_online',
  },
]

export function funcionDeRuta(recurso: string): Funcion | null {
  return REGLAS_RUTA.find((r) => r.patron.test(recurso))?.funcion ?? null
}
