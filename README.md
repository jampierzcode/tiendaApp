# appTienda

Sistema de gestión para tiendas de ropa: catálogo, inventario, venta en
mostrador, tienda online con pedidos por WhatsApp, compras a proveedores y
reportes.

Es **multitenant**: una sola instalación atiende a varias tiendas, cada una con
su catálogo, su inventario y su tienda pública.

```
appTienda/
├── tiendaApp/       API — AdonisJS 6 + PostgreSQL
└── tiendaAppFront/  Panel y tienda pública — React 19 + Vite
```

---

## Poner a correr el proyecto

### 1. Base de datos

Se necesita PostgreSQL 13 o superior.

```bash
createdb tienda_app
```

### 2. API

```bash
cd tiendaApp
npm install
cp .env.example .env      # y completa los valores
node ace generate:key     # genera APP_KEY
node ace migration:run
node ace db:seed --files="database/seeders/inicio_app_seeder.ts"
npm run dev
```

Variables que hay que completar en `.env`:

| Variable | Para qué |
|---|---|
| `DB_*` | Conexión a PostgreSQL |
| `APP_KEY` | Firma de sesiones y tokens |
| `CORS_ORIGINS` | Orígenes permitidos, separados por comas |
| `S3_*` | Bucket S3-compatible donde viven las imágenes |
| `S3_PUBLIC_URL` | Solo si el bucket es de lectura pública (ver más abajo) |
| `REPORTS_TIMEZONE` | Zona en la que se agrupan los reportes (`America/Lima`) |

### 3. Panel y tienda

```bash
cd tiendaAppFront
npm install
echo 'VITE_API_URL="http://localhost:4444/api"' > .env
npm run dev
```

---

## Cómo está organizado

### Multitenancy

Las rutas de tienda viven bajo `/api/b/:businessUuid/…`. `TenantMiddleware`
resuelve el negocio desde la URL, comprueba que el usuario autenticado puede
operarlo e inyecta `ctx.business`. **Ningún controlador deduce el negocio por
su cuenta**, y toda tabla de tienda lleva `business_id` puesto por el servidor.

Hay pruebas que lo verifican: `tests/functional/tenant_isolation.spec.ts`.

### Inventario

El stock vive **solo** en `product_variations.stock`, y lo mantiene
`InventoryService` dentro de una transacción con la fila bloqueada
(`FOR UPDATE`). Cada movimiento queda escrito en `stock_movements` con su
saldo resultante, su motivo y su autor.

Todo producto tiene al menos una variación (`is_default`), aunque no tenga
tallas ni colores. `products.stock` es un total cacheado de solo lectura.

Nadie más debe escribir esas columnas: si se hace por fuera, el kardex y el
saldo dejan de cuadrar.

### Ventas

Una venta en mostrador **no es una tabla aparte**: es un `order` con
`channel = 'mostrador'` que nace pagado y con el stock ya descontado. Así la
venta física y la online comparten inventario, cobros y reportes.

Los pedidos de WhatsApp nacen en `pendiente` y **no descuentan stock** hasta que
el negocio los confirma: reservar inventario por cada carrito abandonado
dejaría la tienda en cero.

### Imágenes

Van a un bucket S3-compatible. Como el bucket usado en desarrollo es privado y
su proveedor no implementa ACL ni políticas (`NotImplemented`), las imágenes se
sirven a través de `GET /media/<key>`: el servidor lee con sus credenciales y
devuelve el archivo con caché de un año. La URL es estable, sin token y no
caduca.

En la base se guarda **relativa** (`/media/<key>`), sin dominio. La API le
antepone el origen del request al leerla (`BusinessImage.url`), así que la misma
fila funciona en local y en producción y no hace falta configurar el dominio de
la API en ninguna variable.

Si el bucket se abre a lectura pública, basta con definir `S3_PUBLIC_URL` y las
URLs pasan a apuntar directo al bucket **sin tocar código**.

### Reportes

Se agrupan en la zona horaria de `REPORTS_TIMEZONE`, no en la del servidor. Una
venta de las 8pm en Lima es la 1am del día siguiente en UTC: sin convertir, las
ventas de la tarde caerían en el día equivocado.

El margen sale de `order_items.unit_cost`, que guarda el costo al momento de la
venta. Por eso importa recibir las compras: es lo que actualiza el costo.

---

## Comprobantes

Los tickets que emite el mostrador (`T001-000001`) son **documentos internos,
no válidos como comprobante de pago ante SUNAT**. Llevan serie y correlativo
porque es el enganche previsto para integrar la emisión electrónica con un
tercero más adelante.

---

## Pruebas

```bash
cd tiendaApp
node ace test functional
```

Cubren el aislamiento entre tiendas, la seguridad de las cuentas, el kardex y
la aritmética de los reportes.

---

## Despliegue

```bash
cd tiendaApp && npm run build      # deja el resultado en build/
cd tiendaAppFront && npm run build # deja el resultado en dist/
```

En producción, antes de arrancar:

1. `NODE_ENV=production`
2. `node ace migration:run --force` — en Railway ya corre solo antes de cada
   despliegue (`preDeployCommand` en `railway.json`)
3. `CORS_ORIGINS` con el dominio real del panel
4. Servir `dist/` con *fallback* a `index.html` — el front usa rutas del
   navegador y `/t/mi-tienda` tiene que llegar a React, no dar 404.

### Copias de seguridad

```bash
pg_dump -Fc tienda_app > respaldo-$(date +%F).dump
```

Las imágenes viven en el bucket y se respaldan aparte.

---

## Pendientes conocidos

- `users.name` tiene índice `UNIQUE`: dos personas no pueden llamarse igual.
  Estorbará cuando entren usuarios de personal por tienda.
- Un negocio pertenece a un solo usuario. No hay vendedores con permisos
  limitados.
- No hay apertura y cierre de caja.
- El seguimiento de couriers es manual: Olva y Shalom no ofrecen API abierta
  para comercios pequeños.
