/*
|--------------------------------------------------------------------------
| Rutas
|--------------------------------------------------------------------------
|
| La API tiene tres zonas:
|
|   1. Pública          — login y registro.
|   2. Cuenta           — lo que un usuario hace sobre sí mismo o sus negocios.
|   3. Negocio (tenant) — todo lo que pertenece a una tienda concreta, bajo
|                         /api/b/:businessUuid. TenantMiddleware resuelve el
|                         negocio desde la URL y comprueba que el usuario
|                         puede operarlo, así que los controladores ya no
|                         tienen que deducirlo.
|
| El grupo de superadmin va aparte, con su propio middleware de rol.
|
*/

import AuthController from '#controllers/auth_controller'
import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

import UsersController from '#controllers/users_controller'
import RolesController from '#controllers/roles_controller'
import ProductsController from '#controllers/products_controller'
import DiscountsController from '#controllers/discounts_controller'
import BusinessesController from '#controllers/businesses_controller'
import CategoryProductsController from '#controllers/category_products_controller'
import ProductAttributesController from '#controllers/product_attributes_controller'
import ProductAttributeValuesController from '#controllers/product_attribute_values_controller'
import ProductVariationsController from '#controllers/product_variations_controller'
import ProductVariationAttributesController from '#controllers/product_variation_attributes_controller'
import CategoriesController from '#controllers/categories_controller'
import SubcategoriesController from '#controllers/subcategories_controller'
import BusinessImagesController from '#controllers/business_images_controller'
import InventoryController from '#controllers/inventory_controller'
import TagsController from '#controllers/tags_controller'
import StorefrontController from '#controllers/storefront_controller'
import OrdersController from '#controllers/orders_controller'
import StoreSettingsController from '#controllers/store_settings_controller'
import MediaController from '#controllers/media_controller'
import PaymentsController from '#controllers/payments_controller'
import CustomersController from '#controllers/customers_controller'
import PosController from '#controllers/pos_controller'
import SuppliersController from '#controllers/suppliers_controller'
import PurchasesController from '#controllers/purchases_controller'
import ReportsController from '#controllers/reports_controller'

router.get('/', async () => ({ hello: 'world' }))

/*
| Imágenes — públicas, sin token.
|
| El bucket es privado y el proveedor no deja abrirlo por API, así que el
| servidor sirve de puente. La URL es estable y cacheable para siempre.
*/
router.get('/media/*', [MediaController, 'show']).as('media.show')

/*
| 1. Público
*/
router.post('/api/login', [AuthController, 'login']).as('auth.login')
router.post('/api/register', [AuthController, 'register']).as('auth.register')

/*
| 1b. Tienda pública — SIN token
|
| Es lo que abre el cliente al escanear el QR. Solo responde si el negocio
| está publicado (`is_public`), y devuelve campos filtrados a mano: nada de
| costos, dueños ni productos inactivos.
*/
router
  .group(() => {
    router.get('/', [StorefrontController, 'show']).as('store.show')
    router.get('/categories', [StorefrontController, 'categories']).as('store.categories')
    router.get('/filters', [StorefrontController, 'filters']).as('store.filters')
    router.get('/products', [StorefrontController, 'products']).as('store.products')
    router.get('/products/:productSlug', [StorefrontController, 'product']).as('store.product')
    router.post('/orders', [StorefrontController, 'createOrder']).as('store.orders.create')
    router
      .post('/orders/:code/sent', [StorefrontController, 'markOrderSent'])
      .as('store.orders.sent')
  })
  .prefix('/api/store/:slug')

/*
| 2. Cuenta del usuario autenticado
*/
router
  .group(() => {
    router.get('/me', [AuthController, 'me']).as('auth.me')
    router.delete('/logout', [AuthController, 'logout']).as('auth.logout')
    router.post('/updatePassword', [AuthController, 'updatePassword']).as('auth.updatePassword')

    // Negocios del propio usuario
    router.get('/businesses/byUser', [BusinessesController, 'getByUser']).as('business.byUser')
    router.get('/businesses/byUuid/:uuid', [BusinessesController, 'getByUuid']).as('business.byUuid')
    router.post('/businesses', [BusinessesController, 'store']).as('business.store')
    router.get('/businesses/:id', [BusinessesController, 'show']).as('business.show')
    router.put('/businesses/:id', [BusinessesController, 'update']).as('business.update')
  })
  .prefix('/api')
  .use(middleware.auth({ guards: ['api'] }))

/*
| 3. Superadmin
*/
router
  .group(() => {
    router.get('/businesses', [BusinessesController, 'index']).as('business.index')
    router.delete('/businesses/:id', [BusinessesController, 'destroy']).as('business.destroy')

    router.get('/users/admins', [UsersController, 'admins'])
    router.get('/users', [UsersController, 'index']).as('users.index')
    router.get('/users/:id', [UsersController, 'show']).as('users.show')
    router.post('/users', [UsersController, 'store']).as('users.store')
    router.put('/users/:id', [UsersController, 'update']).as('users.update')
    router.delete('/users/:id', [UsersController, 'destroy']).as('users.destroy')

    router.get('/roles', [RolesController, 'index']).as('roles.index')
    router.get('/roles/:id', [RolesController, 'show']).as('roles.show')
    router.post('/roles', [RolesController, 'store']).as('roles.store')
    router.put('/roles/:id', [RolesController, 'update']).as('roles.update')
    router.delete('/roles/:id', [RolesController, 'destroy']).as('roles.destroy')
  })
  .prefix('/api')
  .use([middleware.auth({ guards: ['api'] }), middleware.role(['superadmin'])])

/*
| 4. Negocio: todo lo que vive dentro de una tienda
*/
router
  .group(() => {
    // Productos
    router.get('/products', [ProductsController, 'index'])
    router.get('/products/:id', [ProductsController, 'show'])
    router.post('/products', [ProductsController, 'store'])
    router.put('/products/:id', [ProductsController, 'update'])
    router.delete('/products/:id', [ProductsController, 'destroy'])

    // Galería
    router.get('/business-images', [BusinessImagesController, 'index'])
    router.post('/business-images', [BusinessImagesController, 'store'])
    router.post('/business-images/upload', [BusinessImagesController, 'upload'])
    router.put('/business-images/:id', [BusinessImagesController, 'update'])
    router.delete('/business-images/:id', [BusinessImagesController, 'destroy'])

    // Categorías
    router.get('/categories', [CategoriesController, 'index'])
    router.get('/categories/:id', [CategoriesController, 'show'])
    router.post('/categories', [CategoriesController, 'store'])
    router.put('/categories/:id', [CategoriesController, 'update'])
    router.delete('/categories/:id', [CategoriesController, 'destroy'])

    router.get('/subcategories', [SubcategoriesController, 'index'])
    router.get('/subcategories/:id', [SubcategoriesController, 'show'])
    router.post('/subcategories', [SubcategoriesController, 'store'])
    router.put('/subcategories/:id', [SubcategoriesController, 'update'])
    router.delete('/subcategories/:id', [SubcategoriesController, 'destroy'])

    router.get('/category-products', [CategoryProductsController, 'index'])
    router.post('/category-products', [CategoryProductsController, 'store'])
    router.delete('/category-products/:id', [CategoryProductsController, 'destroy'])

    // Etiquetas
    router.get('/tags', [TagsController, 'index'])
    router.post('/tags', [TagsController, 'store'])
    router.put('/tags/:id', [TagsController, 'update'])
    router.delete('/tags/:id', [TagsController, 'destroy'])
    router.put('/products/:productId/tags', [TagsController, 'syncForProduct'])

    // Atributos y variaciones
    router.get('/product-attributes', [ProductAttributesController, 'index'])
    router.get('/product-attributes/:id', [ProductAttributesController, 'show'])
    router.post('/product-attributes', [ProductAttributesController, 'store'])
    router.put('/product-attributes/:id', [ProductAttributesController, 'update'])
    router.delete('/product-attributes/:id', [ProductAttributesController, 'destroy'])

    router.get('/product-attribute-values', [ProductAttributeValuesController, 'index'])
    router.post('/product-attribute-values', [ProductAttributeValuesController, 'store'])
    router.put('/product-attribute-values/:id', [ProductAttributeValuesController, 'update'])
    router.delete('/product-attribute-values/:id', [ProductAttributeValuesController, 'destroy'])

    router.get('/product-variations', [ProductVariationsController, 'index'])
    router.post('/product-variations', [ProductVariationsController, 'store'])
    router.put('/product-variations/:id', [ProductVariationsController, 'update'])
    router.delete('/product-variations/:id', [ProductVariationsController, 'destroy'])

    router.get('/product-variation-attributes/:variationId', [
      ProductVariationAttributesController,
      'index',
    ])
    router.post('/product-variation-attributes', [ProductVariationAttributesController, 'store'])
    router.delete('/product-variation-attributes/:id', [
      ProductVariationAttributesController,
      'destroy',
    ])

    // Inventario (kardex)
    router.get('/inventory/movements', [InventoryController, 'movements'])
    router.get('/inventory/low-stock', [InventoryController, 'lowStock'])
    router.post('/inventory/adjust', [InventoryController, 'adjust'])
    router.post('/inventory/move', [InventoryController, 'move'])

    // Pedidos
    router.get('/orders', [OrdersController, 'index'])
    router.get('/orders/summary', [OrdersController, 'summary'])
    router.get('/orders/:id', [OrdersController, 'show'])
    router.put('/orders/:id/status', [OrdersController, 'updateStatus'])
    router.put('/orders/:id/shipping', [OrdersController, 'updateShipping'])

    // Pagos del pedido
    router.get('/orders/:orderId/payments', [PaymentsController, 'index'])
    router.post('/orders/:orderId/payments', [PaymentsController, 'store'])
    router.delete('/payments/:id', [PaymentsController, 'destroy'])

    // Mostrador
    router.get('/pos/search', [PosController, 'search'])
    router.post('/pos/sell', [PosController, 'sell'])
    router.get('/pos/ticket/:id', [PosController, 'ticket'])

    // Proveedores y compras
    router.get('/suppliers', [SuppliersController, 'index'])
    router.post('/suppliers', [SuppliersController, 'store'])
    router.put('/suppliers/:id', [SuppliersController, 'update'])
    router.delete('/suppliers/:id', [SuppliersController, 'destroy'])

    router.get('/purchases', [PurchasesController, 'index'])
    router.get('/purchases/:id', [PurchasesController, 'show'])
    router.post('/purchases', [PurchasesController, 'store'])
    router.post('/purchases/:id/receive', [PurchasesController, 'receive'])
    router.post('/purchases/:id/cancel', [PurchasesController, 'cancel'])

    // Devoluciones
    router.get('/returns', [PurchasesController, 'returnsIndex'])
    router.post('/returns', [PurchasesController, 'createReturn'])

    // Reportes
    router.get('/reports/overview', [ReportsController, 'overview'])
    router.get('/reports/sales', [ReportsController, 'sales'])
    router.get('/reports/top-products', [ReportsController, 'topProducts'])

    // Clientes
    router.get('/customers', [CustomersController, 'index'])
    router.get('/customers/:id', [CustomersController, 'show'])
    router.put('/customers/:id', [CustomersController, 'update'])

    // Configuración de la tienda pública
    router.get('/store-settings', [StoreSettingsController, 'show'])
    router.put('/store-settings', [StoreSettingsController, 'update'])

    // Descuentos
    router.get('/discounts', [DiscountsController, 'index'])
    router.post('/discounts', [DiscountsController, 'store'])
    router.put('/discounts/:id', [DiscountsController, 'update'])
    router.delete('/discounts/:id', [DiscountsController, 'destroy'])
  })
  .prefix('/api/b/:businessUuid')
  .use([middleware.auth({ guards: ['api'] }), middleware.tenant()])
