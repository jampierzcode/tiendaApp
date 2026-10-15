/**
 * Catálogos de arranque por rubro.
 *
 * Son datos puros: el wizard los siembra en el negocio nuevo para que el
 * cliente vea una tienda real en el primer minuto, en vez de un panel vacío.
 * Los restaurantes parten del menú de `demo-restaurante`, repartido por subtipo.
 *
 * Sin imágenes a propósito: cada negocio es dueño de las suyas (ver
 * CatalogCloneService). Los precios son referenciales, en soles.
 */

export type TemplateProduct = { name: string; price: number; cost?: number; description?: string }

export type TemplateModifierGroup = {
  name: string
  options: { name: string; priceDelta?: number }[]
  /** Categorías (por nombre) a cuyos platos se asigna el grupo. */
  appliesTo: string[]
  minSelect?: number
  maxSelect?: number
}

export type CatalogTemplate = {
  key: string
  businessType: 'retail' | 'restaurant'
  label: string
  description: string
  categories: { name: string; products: TemplateProduct[] }[]
  modifierGroups?: TemplateModifierGroup[]
  /** Solo retail: unidades con las que arranca cada producto. */
  initialStock?: number
}

export const CATALOG_TEMPLATES: CatalogTemplate[] = [
  {
    key: 'polleria',
    businessType: 'restaurant',
    label: 'Pollería',
    description: 'Pollo a la brasa, parrillas, complementos y bebidas.',
    categories: [
      {
        name: 'Pollo a la brasa',
        products: [
          { name: '1/4 de Pollo con Papas', price: 18 },
          { name: '1/2 Pollo con Papas y Ensalada', price: 34 },
          { name: '1 Pollo con Papas y Ensalada', price: 62 },
          { name: 'Mostrito (Pollo + Chaufa)', price: 22 },
        ],
      },
      {
        name: 'Parrillas',
        products: [
          { name: 'Anticuchos x2', price: 20 },
          { name: 'Chuleta a la Parrilla', price: 24 },
        ],
      },
      {
        name: 'Complementos',
        products: [
          { name: 'Papas Fritas', price: 10 },
          { name: 'Ensalada Fresca', price: 8 },
          { name: 'Yuca Frita', price: 9 },
        ],
      },
      {
        name: 'Bebidas',
        products: [
          { name: 'Chicha Morada (jarra 1L)', price: 18 },
          { name: 'Inca Kola 500ml', price: 5 },
          { name: 'Limonada Clásica', price: 8 },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Cremas',
        appliesTo: ['Pollo a la brasa', 'Parrillas'],
        maxSelect: 3,
        options: [{ name: 'Ají cremoso' }, { name: 'Mayonesa' }, { name: 'Ketchup' }, { name: 'Mostaza miel' }],
      },
    ],
  },
  {
    key: 'cafeteria',
    businessType: 'restaurant',
    label: 'Cafetería',
    description: 'Cafés, postres, sándwiches y bebidas frías.',
    categories: [
      {
        name: 'Cafés',
        products: [
          { name: 'Espresso', price: 7 },
          { name: 'Americano', price: 8 },
          { name: 'Capuchino', price: 12 },
          { name: 'Latte', price: 13 },
          { name: 'Moka', price: 14 },
        ],
      },
      {
        name: 'Postres',
        products: [
          { name: 'Tres Leches', price: 12 },
          { name: 'Cheesecake de Fresa', price: 14 },
          { name: 'Brownie con Helado', price: 12 },
        ],
      },
      {
        name: 'Para comer',
        products: [
          { name: 'Croissant Jamón y Queso', price: 11 },
          { name: 'Club Sandwich', price: 18 },
        ],
      },
      {
        name: 'Bebidas frías',
        products: [
          { name: 'Frappé de Caramelo', price: 16 },
          { name: 'Limonada Frozen', price: 9 },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Tamaño del café',
        appliesTo: ['Cafés'],
        minSelect: 1,
        maxSelect: 1,
        options: [{ name: 'Chico' }, { name: 'Grande', priceDelta: 2 }],
      },
      {
        name: 'Tipo de leche',
        appliesTo: ['Cafés'],
        maxSelect: 1,
        options: [{ name: 'Entera' }, { name: 'Deslactosada' }, { name: 'Almendra', priceDelta: 3 }],
      },
    ],
  },
  {
    key: 'comida_rapida',
    businessType: 'restaurant',
    label: 'Comida rápida',
    description: 'Hamburguesas, alitas, complementos y bebidas.',
    categories: [
      {
        name: 'Hamburguesas',
        products: [
          { name: 'Hamburguesa Clásica', price: 18 },
          { name: 'Cheeseburger', price: 17 },
          { name: 'Hamburguesa Doble Carne', price: 24 },
          { name: 'Hamburguesa Pollo Crispy', price: 19 },
          { name: 'Hamburguesa BBQ Bacon', price: 22 },
        ],
      },
      {
        name: 'Alitas y nuggets',
        products: [
          { name: 'Alitas BBQ x6', price: 22 },
          { name: 'Nuggets x10', price: 16 },
        ],
      },
      {
        name: 'Complementos',
        products: [
          { name: 'Papas Fritas', price: 10 },
          { name: 'Aros de Cebolla', price: 12 },
        ],
      },
      {
        name: 'Bebidas',
        products: [
          { name: 'Coca-Cola 500ml', price: 5 },
          { name: 'Milkshake', price: 14 },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Extras',
        appliesTo: ['Hamburguesas'],
        options: [{ name: 'Queso extra', priceDelta: 2 }, { name: 'Tocino', priceDelta: 3 }],
      },
      {
        name: 'Salsas',
        appliesTo: ['Hamburguesas', 'Alitas y nuggets'],
        maxSelect: 2,
        options: [{ name: 'Mayonesa' }, { name: 'Ketchup' }, { name: 'BBQ' }, { name: 'Ranch' }],
      },
    ],
  },
  {
    key: 'jugueria',
    businessType: 'restaurant',
    label: 'Juguería',
    description: 'Jugos, batidos, ensaladas de fruta y sándwiches.',
    categories: [
      {
        name: 'Jugos',
        products: [
          { name: 'Jugo de Naranja', price: 7 },
          { name: 'Jugo de Papaya', price: 8 },
          { name: 'Jugo Surtido', price: 9 },
          { name: 'Jugo de Fresa', price: 9 },
          { name: 'Jugo de Mango', price: 9 },
        ],
      },
      {
        name: 'Batidos',
        products: [
          { name: 'Batido de Fresa con Leche', price: 10 },
          { name: 'Batido de Plátano con Leche', price: 9 },
          { name: 'Batido de Lúcuma', price: 11 },
        ],
      },
      {
        name: 'Ensaladas de fruta',
        products: [
          { name: 'Ensalada de Frutas', price: 10 },
          { name: 'Ensalada de Frutas con Yogurt y Granola', price: 13 },
        ],
      },
      {
        name: 'Para comer',
        products: [
          { name: 'Pan con Pollo', price: 8 },
          { name: 'Pan con Chicharrón', price: 10 },
          { name: 'Pan con Tortilla', price: 6 },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Tamaño',
        appliesTo: ['Jugos', 'Batidos'],
        minSelect: 1,
        maxSelect: 1,
        options: [{ name: 'Vaso' }, { name: 'Jarra', priceDelta: 6 }],
      },
      {
        name: 'Endulzante',
        appliesTo: ['Jugos', 'Batidos'],
        maxSelect: 1,
        options: [{ name: 'Azúcar' }, { name: 'Miel', priceDelta: 1 }, { name: 'Sin azúcar' }],
      },
      {
        name: 'Extras',
        appliesTo: ['Batidos', 'Ensaladas de fruta'],
        options: [{ name: 'Granola', priceDelta: 2 }, { name: 'Quinua', priceDelta: 2 }, { name: 'Helado', priceDelta: 3 }],
      },
    ],
  },
  {
    key: 'ropa',
    businessType: 'retail',
    label: 'Tienda de ropa',
    description: 'Polos, pantalones y casacas listos para vender.',
    initialStock: 10,
    categories: [
      {
        name: 'Polos',
        products: [
          { name: 'Polo Básico Algodón', price: 39.9, cost: 18 },
          { name: 'Polo Oversize Negro', price: 49.9, cost: 22.5 },
          { name: 'Polo Estampado', price: 45.9, cost: 20 },
        ],
      },
      {
        name: 'Pantalones',
        products: [
          { name: 'Jean Slim Azul', price: 89.9, cost: 45 },
          { name: 'Pantalón Cargo Beige', price: 79.9, cost: 38 },
          { name: 'Jogger Deportivo', price: 69.9, cost: 32 },
        ],
      },
      {
        name: 'Casacas',
        products: [
          { name: 'Casaca Jean Clásica', price: 129.9, cost: 62 },
          { name: 'Casaca Cuero Sintético', price: 189.9, cost: 95 },
          { name: 'Casaca Cortaviento', price: 99.9, cost: 48 },
          { name: 'Polera con Capucha', price: 84.9, cost: 40 },
        ],
      },
    ],
  },
  {
    key: 'repuestos',
    businessType: 'retail',
    label: 'Tienda de repuestos',
    description: 'Frenos, filtros, lubricantes y partes eléctricas.',
    initialStock: 15,
    categories: [
      {
        name: 'Frenos',
        products: [
          { name: 'Pastillas de Freno Delanteras', price: 85, cost: 48 },
          { name: 'Disco de Freno', price: 140, cost: 85 },
        ],
      },
      {
        name: 'Motor',
        products: [
          { name: 'Filtro de Aceite', price: 25, cost: 12 },
          { name: 'Filtro de Aire', price: 35, cost: 18 },
          { name: 'Bujías x4', price: 60, cost: 32 },
          { name: 'Correa de Distribución', price: 120, cost: 70 },
        ],
      },
      {
        name: 'Lubricantes',
        products: [
          { name: 'Aceite 10W40 (1 galón)', price: 95, cost: 60 },
          { name: 'Refrigerante 1 galón', price: 38, cost: 20 },
        ],
      },
      {
        name: 'Eléctrico',
        products: [
          { name: 'Batería 12V 45Ah', price: 320, cost: 230 },
          { name: 'Faro Delantero LED', price: 150, cost: 90 },
        ],
      },
    ],
  },
]

export function findTemplate(key: string | null | undefined) {
  return CATALOG_TEMPLATES.find((t) => t.key === key) ?? null
}
