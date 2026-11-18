/**
 * Catálogos de arranque por rubro.
 *
 * Son datos puros: el wizard los siembra en el negocio nuevo para que el
 * cliente vea una tienda real en el primer minuto, en vez de un panel vacío.
 * Los restaurantes parten del menú de `demo-restaurante`, repartido por subtipo.
 *
 * Las fotos de la plantilla viven en el bucket bajo `templates/<rubro>/` y al
 * registrarse se COPIAN a `businesses/<id>/`: cada negocio es dueño de las
 * suyas y borrarlas no toca la original (ver CatalogCloneService).
 * Los precios son referenciales, en soles.
 */

export type TemplateProduct = {
  name: string
  price: number
  cost?: number
  description?: string
  /** Clave en el bucket de la foto de muestra, p. ej. `templates/polleria/chuleta.jpg`. */
  image?: string
}

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
          {
            name: '1/4 de Pollo con Papas',
            price: 18,
            description:
              'Cuarto de pollo a la brasa jugoso, papas fritas crocantes y cremas de la casa.',
            image: 'templates/polleria/cuarto-pollo.jpg',
          },
          {
            name: '1/2 Pollo con Papas y Ensalada',
            price: 34,
            description:
              'Medio pollo a la leña con papas fritas y ensalada fresca. Ideal para dos.',
            image: 'templates/polleria/medio-pollo.jpg',
          },
          {
            name: '1 Pollo con Papas y Ensalada',
            price: 62,
            description:
              'Pollo entero a la brasa, papas familiares y ensalada. Para compartir en familia.',
            image: 'templates/polleria/pollo-entero.jpg',
          },
          {
            name: 'Mostrito (Pollo + Chaufa)',
            price: 22,
            description:
              'Cuarto de pollo a la brasa con arroz chaufa y papas fritas. El clásico limeño.',
            image: 'templates/polleria/mostrito.jpg',
          },
        ],
      },
      {
        name: 'Parrillas',
        products: [
          {
            name: 'Anticuchos x2',
            price: 20,
            description:
              'Dos palitos de corazón de res marinados al ají panca, con papa dorada y choclo.',
            image: 'templates/polleria/anticuchos.jpg',
          },
          {
            name: 'Chuleta a la Parrilla',
            price: 24,
            description: 'Chuleta de cerdo a la parrilla con papas fritas y ensalada.',
            image: 'templates/polleria/chuleta.jpg',
          },
        ],
      },
      {
        name: 'Complementos',
        products: [
          {
            name: 'Papas Fritas',
            price: 10,
            description: 'Porción de papas fritas crocantes.',
            image: 'templates/polleria/papas-fritas.jpeg',
          },
          {
            name: 'Ensalada Fresca',
            price: 8,
            description: 'Lechuga, tomate, pepino y zanahoria con vinagreta de la casa.',
            image: 'templates/polleria/ensalada-fresca.jpg',
          },
          {
            name: 'Yuca Frita',
            price: 9,
            description: 'Yuca dorada con salsa huancaína.',
            image: 'templates/polleria/yuca-frita.jpg',
          },
        ],
      },
      {
        name: 'Bebidas',
        products: [
          {
            name: 'Chicha Morada (jarra 1L)',
            price: 18,
            description: 'Chicha morada casera con piña y canela.',
            image: 'templates/polleria/chicha-morada.jpg',
          },
          {
            name: 'Inca Kola 500ml',
            price: 5,
            description: 'La bebida del sabor del Perú, bien helada.',
            image: 'templates/polleria/inca-kola.jpg',
          },
          {
            name: 'Limonada Clásica',
            price: 8,
            description: 'Limonada natural recién exprimida.',
            image: 'templates/polleria/limonada.jpg',
          },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Cremas',
        appliesTo: ['Pollo a la brasa', 'Parrillas'],
        maxSelect: 3,
        options: [
          { name: 'Ají cremoso' },
          { name: 'Mayonesa' },
          { name: 'Ketchup' },
          { name: 'Mostaza miel' },
        ],
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
          {
            name: 'Espresso',
            price: 7,
            description: 'Café espresso intenso, servido corto en taza pequeña.',
            image: 'templates/cafeteria/espresso.jpg',
          },
          {
            name: 'Americano',
            price: 8,
            description: 'Espresso alargado con agua caliente, suave y aromático.',
            image: 'templates/cafeteria/americano.jpg',
          },
          {
            name: 'Capuchino',
            price: 12,
            description: 'Espresso con leche vaporizada y abundante espuma.',
            image: 'templates/cafeteria/capuchino.jpg',
          },
          {
            name: 'Latte',
            price: 13,
            description: 'Espresso con bastante leche cremosa y un toque de espuma.',
            image: 'templates/cafeteria/latte.jpg',
          },
          {
            name: 'Moka',
            price: 14,
            description: 'Espresso con chocolate y leche, coronado con crema.',
            image: 'templates/cafeteria/moka.jpg',
          },
        ],
      },
      {
        name: 'Postres',
        products: [
          {
            name: 'Tres Leches',
            price: 12,
            description: 'Bizcocho bañado en tres leches con merengue y canela.',
            image: 'templates/cafeteria/tres-leches.jpg',
          },
          {
            name: 'Cheesecake de Fresa',
            price: 14,
            description: 'Cheesecake cremoso con base de galleta y salsa de fresa.',
            image: 'templates/cafeteria/cheesecake-fresa.jpg',
          },
          {
            name: 'Brownie con Helado',
            price: 12,
            description: 'Brownie tibio de chocolate con una bola de helado de vainilla.',
            image: 'templates/cafeteria/brownie-helado.jpg',
          },
        ],
      },
      {
        name: 'Para comer',
        products: [
          {
            name: 'Croissant Jamón y Queso',
            price: 11,
            description: 'Croissant hojaldrado relleno de jamón y queso derretido.',
            image: 'templates/cafeteria/croissant-jamon-queso.jpg',
          },
          {
            name: 'Club Sandwich',
            price: 18,
            description: 'Triple de pollo, tocino, huevo, lechuga y tomate con papas al hilo.',
            image: 'templates/cafeteria/club-sandwich.jpg',
          },
        ],
      },
      {
        name: 'Bebidas frías',
        products: [
          {
            name: 'Frappé de Caramelo',
            price: 16,
            description: 'Café helado batido con caramelo y crema batida.',
            image: 'templates/cafeteria/frappe-caramelo.jpg',
          },
          {
            name: 'Limonada Frozen',
            price: 9,
            description: 'Limonada granizada, bien helada y refrescante.',
            image: 'templates/cafeteria/limonada-frozen.jpg',
          },
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
        options: [
          { name: 'Entera' },
          { name: 'Deslactosada' },
          { name: 'Almendra', priceDelta: 3 },
        ],
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
          {
            name: 'Hamburguesa Clásica',
            price: 18,
            description: 'Carne a la parrilla, lechuga, tomate y salsas de la casa.',
            image: 'templates/comida_rapida/hamburguesa-clasica.jpg',
          },
          {
            name: 'Cheeseburger',
            price: 17,
            description: 'Carne a la parrilla con queso cheddar derretido.',
            image: 'templates/comida_rapida/cheeseburger.jpg',
          },
          {
            name: 'Hamburguesa Doble Carne',
            price: 24,
            description: 'Doble carne, doble queso y pepinillos.',
            image: 'templates/comida_rapida/hamburguesa-doble.jpg',
          },
          {
            name: 'Hamburguesa Pollo Crispy',
            price: 19,
            description: 'Filete de pollo empanizado y crocante con lechuga y mayonesa.',
            image: 'templates/comida_rapida/hamburguesa-pollo-crispy.jpg',
          },
          {
            name: 'Hamburguesa BBQ Bacon',
            price: 22,
            description: 'Carne, tocino crocante, queso y salsa BBQ.',
            image: 'templates/comida_rapida/hamburguesa-bbq-bacon.jpg',
          },
        ],
      },
      {
        name: 'Alitas y nuggets',
        products: [
          {
            name: 'Alitas BBQ x6',
            price: 22,
            description: 'Seis alitas bañadas en salsa BBQ.',
            image: 'templates/comida_rapida/alitas-bbq.jpg',
          },
          {
            name: 'Nuggets x10',
            price: 16,
            description: 'Diez nuggets de pollo dorados y crocantes.',
            image: 'templates/comida_rapida/nuggets.jpg',
          },
        ],
      },
      {
        name: 'Complementos',
        products: [
          {
            name: 'Papas Fritas',
            price: 10,
            description: 'Papas fritas crocantes, recién hechas.',
            image: 'templates/comida_rapida/papas-fritas.jpg',
          },
          {
            name: 'Aros de Cebolla',
            price: 12,
            description: 'Aros de cebolla empanizados y crocantes.',
            image: 'templates/comida_rapida/aros-cebolla.jpg',
          },
        ],
      },
      {
        name: 'Bebidas',
        products: [
          {
            name: 'Coca-Cola 500ml',
            price: 5,
            description: 'Gaseosa helada de 500 ml.',
            image: 'templates/comida_rapida/gaseosa-cola.jpg',
          },
          {
            name: 'Milkshake',
            price: 14,
            description: 'Batido cremoso de vainilla con crema batida.',
            image: 'templates/comida_rapida/milkshake.jpg',
          },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Extras',
        appliesTo: ['Hamburguesas'],
        options: [
          { name: 'Queso extra', priceDelta: 2 },
          { name: 'Tocino', priceDelta: 3 },
        ],
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
    key: 'cevicheria',
    businessType: 'restaurant',
    label: 'Cevichería',
    description: 'Ceviches, tiraditos, chicharrones, arroces de mar y bebidas.',
    categories: [
      {
        name: 'Ceviches',
        products: [
          {
            name: 'Ceviche Clásico',
            price: 32,
            description: 'Pescado fresco en leche de tigre, con camote, choclo y cancha.',
            image: 'templates/cevicheria/ceviche-clasico.jpg',
          },
          {
            name: 'Ceviche Mixto',
            price: 38,
            description: 'Pescado, langostinos, pulpo y calamar en leche de tigre.',
            image: 'templates/cevicheria/ceviche-mixto.jpg',
          },
          {
            name: 'Ceviche de Conchas Negras',
            price: 45,
            description: 'Conchas negras frescas en su jugo con limón y cebolla.',
            image: 'templates/cevicheria/ceviche-conchas-negras.jpg',
          },
          {
            name: 'Leche de Tigre',
            price: 16,
            description: 'Concentrado de ceviche con trocitos de pescado. Levanta muertos.',
            image: 'templates/cevicheria/leche-de-tigre.jpg',
          },
        ],
      },
      {
        name: 'Tiraditos y entradas',
        products: [
          {
            name: 'Tiradito al Ají Amarillo',
            price: 34,
            description: 'Láminas de pescado bañadas en crema de ají amarillo.',
            image: 'templates/cevicheria/tiradito-aji-amarillo.jpg',
          },
          {
            name: 'Causa de Pescado',
            price: 18,
            description: 'Causa limeña de papa amarilla rellena de pescado.',
            image: 'templates/cevicheria/causa-pescado.jpg',
          },
          {
            name: 'Choritos a la Chalaca',
            price: 24,
            description: 'Choros con sarsa de cebolla, tomate, choclo y limón.',
            image: 'templates/cevicheria/choritos-chalaca.jpg',
          },
        ],
      },
      {
        name: 'Fritos y marinos',
        products: [
          {
            name: 'Chicharrón de Pescado',
            price: 30,
            description: 'Trozos de pescado fritos y crocantes con yuca y sarsa criolla.',
            image: 'templates/cevicheria/chicharron-pescado.jpg',
          },
          {
            name: 'Jalea Mixta',
            price: 48,
            description: 'Mariscos y pescado fritos con yuca, sarsa criolla y tártara.',
            image: 'templates/cevicheria/jalea-mixta.jpg',
          },
          {
            name: 'Arroz con Mariscos',
            price: 36,
            description: 'Arroz meloso con mariscos y un toque de ají panca.',
            image: 'templates/cevicheria/arroz-mariscos.jpg',
          },
          {
            name: 'Chaufa de Mariscos',
            price: 34,
            description: 'Arroz chaufa salteado al wok con mariscos.',
            image: 'templates/cevicheria/chaufa-mariscos.jpg',
          },
        ],
      },
      {
        name: 'Bebidas',
        products: [
          {
            name: 'Chicha Morada (jarra 1L)',
            price: 18,
            description: 'Chicha morada casera con frutas, en jarra de un litro.',
            image: 'templates/cevicheria/chicha-morada.jpg',
          },
          {
            name: 'Limonada Clásica',
            price: 8,
            description: 'Limonada fresca recién exprimida.',
            image: 'templates/cevicheria/limonada.jpg',
          },
          {
            name: 'Inca Kola 500ml',
            price: 5,
            description: 'Gaseosa helada de 500 ml.',
            image: 'templates/cevicheria/gaseosa-amarilla.jpg',
          },
          {
            name: 'Cerveza Pilsen 620ml',
            price: 12,
            description: 'Cerveza helada de 620 ml.',
            image: 'templates/cevicheria/cerveza.jpg',
          },
        ],
      },
    ],
    modifierGroups: [
      {
        name: 'Nivel de ají',
        appliesTo: ['Ceviches', 'Tiraditos y entradas'],
        maxSelect: 1,
        options: [{ name: 'Sin ají' }, { name: 'Normal' }, { name: 'Picante' }],
      },
      {
        name: 'Extras',
        appliesTo: ['Ceviches', 'Fritos y marinos'],
        options: [
          { name: 'Porción de cancha', priceDelta: 3 },
          { name: 'Camote sancochado', priceDelta: 4 },
          { name: 'Yuca frita', priceDelta: 6 },
        ],
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
          {
            name: 'Jugo de Naranja',
            price: 7,
            description: 'Jugo de naranja recién exprimido.',
            image: 'templates/jugueria/jugo-naranja.jpg',
          },
          {
            name: 'Jugo de Papaya',
            price: 8,
            description: 'Jugo de papaya natural, suave y cremoso.',
            image: 'templates/jugueria/jugo-papaya.jpg',
          },
          {
            name: 'Jugo Surtido',
            price: 9,
            description: 'Mezcla de papaya, plátano, piña y naranja.',
            image: 'templates/jugueria/jugo-surtido.jpg',
          },
          {
            name: 'Jugo de Fresa',
            price: 9,
            description: 'Jugo de fresas naturales.',
            image: 'templates/jugueria/jugo-fresa.jpg',
          },
          {
            name: 'Jugo de Mango',
            price: 9,
            description: 'Jugo de mango maduro, bien espeso.',
            image: 'templates/jugueria/jugo-mango.jpg',
          },
        ],
      },
      {
        name: 'Batidos',
        products: [
          {
            name: 'Batido de Fresa con Leche',
            price: 10,
            description: 'Fresas licuadas con leche fría.',
            image: 'templates/jugueria/batido-fresa.jpg',
          },
          {
            name: 'Batido de Plátano con Leche',
            price: 9,
            description: 'Plátano licuado con leche, ideal para el desayuno.',
            image: 'templates/jugueria/batido-platano.jpg',
          },
          {
            name: 'Batido de Lúcuma',
            price: 11,
            description: 'Batido cremoso de lúcuma, el sabor del Perú.',
            image: 'templates/jugueria/batido-lucuma.jpg',
          },
        ],
      },
      {
        name: 'Ensaladas de fruta',
        products: [
          {
            name: 'Ensalada de Frutas',
            price: 10,
            description: 'Frutas frescas de estación picadas.',
            image: 'templates/jugueria/ensalada-frutas.jpg',
          },
          {
            name: 'Ensalada de Frutas con Yogurt y Granola',
            price: 13,
            description: 'Frutas frescas con yogurt, granola y miel.',
            image: 'templates/jugueria/ensalada-frutas-yogurt.jpg',
          },
        ],
      },
      {
        name: 'Para comer',
        products: [
          {
            name: 'Pan con Pollo',
            price: 8,
            description: 'Pan francés con pollo deshilachado, lechuga y mayonesa.',
            image: 'templates/jugueria/pan-con-pollo.jpg',
          },
          {
            name: 'Pan con Chicharrón',
            price: 10,
            description: 'Pan con chicharrón de cerdo, camote frito y sarsa criolla.',
            image: 'templates/jugueria/pan-con-chicharron.jpg',
          },
          {
            name: 'Pan con Tortilla',
            price: 6,
            description: 'Pan francés con tortilla de huevo casera.',
            image: 'templates/jugueria/pan-con-tortilla.jpg',
          },
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
        options: [
          { name: 'Granola', priceDelta: 2 },
          { name: 'Quinua', priceDelta: 2 },
          { name: 'Helado', priceDelta: 3 },
        ],
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
