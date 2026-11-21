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
import MenuHoyController from '#controllers/menu_hoy_controller'
import SubcategoriesController from '#controllers/subcategories_controller'
import BusinessImagesController from '#controllers/business_images_controller'
import InventoryController from '#controllers/inventory_controller'
import TagsController from '#controllers/tags_controller'
import CustomerAccountsController from '#controllers/customer_accounts_controller'
import PushController from '#controllers/push_controller'
import OrderMessagesController from '#controllers/order_messages_controller'
import NotificationsController from '#controllers/notifications_controller'
import StorefrontController from '#controllers/storefront_controller'
import OrdersController from '#controllers/orders_controller'
import StoreSettingsController from '#controllers/store_settings_controller'
import MediaController from '#controllers/media_controller'
import PaymentsController from '#controllers/payments_controller'
import CustomersController from '#controllers/customers_controller'
import PosController from '#controllers/pos_controller'
import SuppliersController from '#controllers/suppliers_controller'
import PurchasesController from '#controllers/purchases_controller'
import PriceReviewsController from '#controllers/price_reviews_controller'
import ShipmentsController from '#controllers/shipments_controller'
import PaymentProofsController from '#controllers/payment_proofs_controller'
import PaymentMethodsController from '#controllers/payment_methods_controller'
import ProductGalleryController from '#controllers/product_gallery_controller'
import ReportsController from '#controllers/reports_controller'
import ModifierGroupsController from '#controllers/modifier_groups_controller'
import IngredientsController from '#controllers/ingredients_controller'
import RecipesController from '#controllers/recipes_controller'
import SubscriptionsController from '#controllers/subscriptions_controller'
import PlansController from '#controllers/plans_controller'
import BusinessSubscriptionsController from '#controllers/business_subscriptions_controller'
import MyPlanController from '#controllers/my_plan_controller'
import WhatsappBotController, { WhatsappPanelController } from '#controllers/whatsapp_controller'
import SalonController, { PosDeviceController } from '#controllers/salon_controller'
import StockController from '#controllers/stock_controller'

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

// Suscripción con wizard: plantillas por rubro y alta de dueño + negocio (7 días gratis).
router.get('/api/subscribe/templates', [SubscriptionsController, 'templates'])
router.get('/api/subscribe/plans', [PlansController, 'publicIndex'])
router.post('/api/subscribe', [SubscriptionsController, 'subscribe']).as('subscribe')

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
    router.get('/facets', [StorefrontController, 'facets']).as('store.facets')
    router.get('/menu', [StorefrontController, 'menu']).as('store.menu')
    router.get('/orders/:code', [StorefrontController, 'orderTracking']).as('store.orders.tracking')
    router.get('/products', [StorefrontController, 'products']).as('store.products')
    router.get('/products/:productSlug', [StorefrontController, 'product']).as('store.product')
    router
      .get('/products/:productSlug/related', [StorefrontController, 'related'])
      .as('store.related')
    router.get('/promotions', [StorefrontController, 'promotions']).as('store.promotions')
    router.post('/quote', [StorefrontController, 'quote']).as('store.quote')
    router.post('/orders', [StorefrontController, 'createOrder']).as('store.orders.create')
    router.post('/account/register', [CustomerAccountsController, 'register'])
    router.get('/orders/:code/messages', [OrderMessagesController, 'publicIndex'])
    router.post('/orders/:code/messages', [OrderMessagesController, 'publicStore'])
    router
      .post('/orders/:code/sent', [StorefrontController, 'markOrderSent'])
      .as('store.orders.sent')
  })
  .prefix('/api/store/:slug')

/*
| 1c. API del bot de WhatsApp — autenticada con x-bot-key, no con token.
*/
router
  .group(() => {
    router.get('/sessions', [WhatsappBotController, 'sessions'])
    router.post('/sessions/:businessUuid', [WhatsappBotController, 'reportSession'])
    router.post('/outbox/claim', [WhatsappBotController, 'claim'])
    router.post('/outbox/:id/result', [WhatsappBotController, 'result'])
    router.post('/inbound', [WhatsappBotController, 'inbound'])
    router.post('/owner-message', [WhatsappBotController, 'ownerMessage'])
  })
  .prefix('/api/bot')

/*
| 1c-bis. Equipos del PDV — sin token: se vinculan con el código del negocio
| y el personal entra solo con su PIN desde un equipo vinculado.
*/
router.post('/api/pos/pair', [PosDeviceController, 'pair'])
router.post('/api/pos/device', [PosDeviceController, 'info'])
router.post('/api/pos/login', [PosDeviceController, 'login'])
router.post('/api/pos/monitor', [PosDeviceController, 'monitor'])
router.post('/api/pos/monitor/items', [PosDeviceController, 'monitorItems'])

/*
| 1d. Cuentas de cliente (global, no depende de una tienda)
*/
router.post('/api/account/login', [CustomerAccountsController, 'login'])
router
  .group(() => {
    router.get('/me', [CustomerAccountsController, 'me'])
    router.put('/profile', [CustomerAccountsController, 'updateProfile'])
    router.get('/orders', [CustomerAccountsController, 'orders'])
    router.post('/link', [CustomerAccountsController, 'link'])
    router.get('/orders/:slug/:code/messages', [OrderMessagesController, 'accountIndex'])
    router.post('/orders/:slug/:code/messages', [OrderMessagesController, 'accountStore'])
  })
  .prefix('/api/account')
  .use(middleware.auth({ guards: ['api'] }))

/*
| 1e. Avisos push del navegador (cualquier usuario con sesión: dueño o cliente)
*/
router
  .group(() => {
    router.get('/key', [PushController, 'key'])
    router.post('/subscribe', [PushController, 'subscribe'])
    router.post('/unsubscribe', [PushController, 'unsubscribe'])
  })
  .prefix('/api/push')
  .use(middleware.auth({ guards: ['api'] }))

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
    router
      .get('/businesses/byUuid/:uuid', [BusinessesController, 'getByUuid'])
      .as('business.byUuid')
    router.post('/businesses', [BusinessesController, 'store']).as('business.store')
    // Otro negocio para la misma cuenta, con wizard y prueba gratis.
    router.post('/account/businesses', [SubscriptionsController, 'addBusiness'])
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
    router.post('/businesses/:id/clone-catalog', [BusinessesController, 'cloneCatalog'])

    // Planes y suscripciones (historial de cobros por negocio)
    router.get('/plans', [PlansController, 'index'])
    router.get('/plans/features', [PlansController, 'features'])
    router.post('/plans', [PlansController, 'store'])
    router.put('/plans/:id', [PlansController, 'update'])
    router.delete('/plans/:id', [PlansController, 'destroy'])
    router.get('/businesses/:id/subscriptions', [BusinessSubscriptionsController, 'index'])
    router.post('/businesses/:id/subscriptions', [BusinessSubscriptionsController, 'store'])
    router.post('/businesses/:id/trial', [BusinessSubscriptionsController, 'trial'])
    router.put('/businesses/:id/addons', [BusinessSubscriptionsController, 'addons'])
    router.post('/subscriptions/:subscriptionId/cancel', [
      BusinessSubscriptionsController,
      'cancel',
    ])
    router.get('/subscriptions', [BusinessSubscriptionsController, 'all'])

    router.get('/users/admins', [UsersController, 'admins'])
    router.get('/users', [UsersController, 'index']).as('users.index')
    router.get('/users/:id', [UsersController, 'show']).as('users.show')
    router.post('/users', [UsersController, 'store']).as('users.store')
    router.put('/users/:id', [UsersController, 'update']).as('users.update')
    router.post('/users/:id/reset-password', [UsersController, 'resetPassword'])
    router.delete('/users/:id', [UsersController, 'destroy']).as('users.destroy')

    router.get('/ai-usage', async () => ({
      status: 'success',
      data: await (await import('#services/ai_usage_service')).default.resumen(),
    }))

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
    router.put('/products/reorder', [ProductsController, 'reorder'])
    router.get('/products/:id', [ProductsController, 'show'])
    router.post('/products', [ProductsController, 'store'])
    router.post('/products/quick', [ProductsController, 'quick'])
    router.get('/products-sku/suggest', [ProductsController, 'suggestSku'])
    router.post('/products/:id/variations', [ProductsController, 'addVariations'])
    router.put('/products/:id', [ProductsController, 'update'])
    router.delete('/products/:id', [ProductsController, 'destroy'])

    // Galería
    router.get('/business-images', [BusinessImagesController, 'index'])
    router.post('/business-images', [BusinessImagesController, 'store'])
    router.post('/business-images/upload', [BusinessImagesController, 'upload'])
    router.put('/business-images/:id', [BusinessImagesController, 'update'])
    router.delete('/business-images/:id', [BusinessImagesController, 'destroy'])

    // Menú de hoy: platos elegidos del día y lo que se acabó (cualquier plan)
    router.get('/menu-hoy', [MenuHoyController, 'show'])
    router.put('/menu-hoy/categories/:id', [MenuHoyController, 'category'])
    router.put('/menu-hoy/products/:id', [MenuHoyController, 'product'])
    router.post('/menu-hoy/repeat', [MenuHoyController, 'repeat'])

    // Categorías
    router.get('/categories', [CategoriesController, 'index'])
    router.put('/categories/reorder', [CategoriesController, 'reorder'])
    router.get('/categories/:id', [CategoriesController, 'show'])
    router.post('/categories', [CategoriesController, 'store'])
    router.put('/categories/:id', [CategoriesController, 'update'])
    router.delete('/categories/:id', [CategoriesController, 'destroy'])

    router.get('/subcategories', [SubcategoriesController, 'index'])
    router.put('/subcategories/reorder', [SubcategoriesController, 'reorder'])
    router.get('/subcategories/:id', [SubcategoriesController, 'show'])
    router.post('/subcategories', [SubcategoriesController, 'store'])
    router.put('/subcategories/:id', [SubcategoriesController, 'update'])
    router.delete('/subcategories/:id', [SubcategoriesController, 'destroy'])

    router.get('/category-products', [CategoryProductsController, 'index'])
    router.post('/category-products', [CategoryProductsController, 'store'])
    router.delete('/category-products/:id', [CategoryProductsController, 'destroy'])

    // Modificadores (restaurante)
    router.get('/modifier-groups', [ModifierGroupsController, 'index'])
    router.post('/modifier-groups', [ModifierGroupsController, 'store'])
    router.put('/modifier-groups/:id', [ModifierGroupsController, 'update'])
    router.delete('/modifier-groups/:id', [ModifierGroupsController, 'destroy'])
    router.get('/products/:productId/modifier-groups', [ModifierGroupsController, 'forProduct'])
    router.put('/products/:productId/modifier-groups', [ModifierGroupsController, 'syncForProduct'])

    // Insumos y recetas (restaurante)
    router.get('/ingredients', [IngredientsController, 'index'])
    router.post('/ingredients', [IngredientsController, 'store'])
    router.put('/ingredients/:id', [IngredientsController, 'update'])
    router.delete('/ingredients/:id', [IngredientsController, 'destroy'])
    router.get('/ingredients/:id/movements', [IngredientsController, 'movements'])
    router.post('/ingredients/:id/movements', [IngredientsController, 'addMovement'])
    router.get('/recipes', [RecipesController, 'index'])
    router.get('/products/:productId/recipe', [RecipesController, 'show'])
    router.put('/products/:productId/recipe', [RecipesController, 'sync'])

    // Bot de WhatsApp
    router.get('/whatsapp', [WhatsappPanelController, 'show'])
    router.post('/whatsapp/connect', [WhatsappPanelController, 'connect'])
    router.post('/whatsapp/disconnect', [WhatsappPanelController, 'disconnect'])
    router.put('/whatsapp/templates', [WhatsappPanelController, 'saveTemplates'])
    router.put('/whatsapp/agent', [WhatsappPanelController, 'saveAgent'])
    router.get('/seller-config', [WhatsappPanelController, 'sellerConfig'])
    router.put('/seller-config', [WhatsappPanelController, 'saveSellerConfig'])
    router.post('/seller-config/greeting-document', [WhatsappPanelController, 'uploadGreetingDocument'])
    router.get('/seller-config/greeting-products', [WhatsappPanelController, 'greetingProducts'])
    router.post('/whatsapp/conversations/:contact/resume-agent', [
      WhatsappPanelController,
      'resumeAgent',
    ])
    router.get('/whatsapp/unread', [WhatsappPanelController, 'unread'])
    router.get('/whatsapp/conversations', [WhatsappPanelController, 'conversations'])
    router.get('/whatsapp/conversations/:contact', [WhatsappPanelController, 'messages'])
    router.post('/whatsapp/conversations/:contact/send', [WhatsappPanelController, 'send'])

    // Etiquetas
    // Notificaciones (leídas / no leídas)
    router.get('/notifications', [NotificationsController, 'index'])
    router.put('/notifications/read-all', [NotificationsController, 'readAll'])
    router.put('/notifications/:id/read', [NotificationsController, 'read'])
    router.delete('/notifications/:id', [NotificationsController, 'destroy'])

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
    router.post('/inventory/manual', [InventoryController, 'manual'])
    router.post('/inventory/move', [InventoryController, 'move'])

    // Pedidos
    router.get('/orders', [OrdersController, 'index'])
    router.get('/orders/summary', [OrdersController, 'summary'])
    router.get('/orders/unread-messages', [OrderMessagesController, 'panelUnread'])
    router.get('/orders/:id/messages', [OrderMessagesController, 'panelIndex'])
    router.post('/orders/:id/messages', [OrderMessagesController, 'panelStore'])
    router.get('/orders/:id', [OrdersController, 'show'])
    router.put('/orders/:id/status', [OrdersController, 'updateStatus'])
    router.put('/orders/:id/shipping', [OrdersController, 'updateShipping'])

    // Pagos del pedido
    router.get('/orders/:orderId/payments', [PaymentsController, 'index'])
    router.post('/payments/receipt', [PaymentsController, 'uploadReceipt'])
    router.post('/orders/:orderId/payments', [PaymentsController, 'store'])
    router.delete('/payments/:id', [PaymentsController, 'destroy'])

    // Mostrador
    router.get('/pos/search', [PosController, 'search'])
    router.post('/pos/sell', [PosController, 'sell'])
    router.get('/pos/ticket/:id', [PosController, 'ticket'])

    // PDV de salón: operación (dueño y personal, según permisos)
    router.get('/salon/me', [SalonController, 'me'])
    router.get('/salon/menu-hoy', [SalonController, 'menuHoy'])
    router.put('/salon/menu-hoy/products/:id', [SalonController, 'menuHoyProduct'])
    router.post('/salon/menu-hoy/repeat', [SalonController, 'menuHoyRepeat'])
    router.get('/salon/tables', [SalonController, 'tables'])
    router.post('/salon/tables/:id/release', [SalonController, 'releaseTable'])
    router.get('/salon/accounts', [SalonController, 'accounts'])
    router.get('/salon/in-progress', [SalonController, 'inProgress'])
    router.get('/salon/web-orders/latest', [SalonController, 'lastWebOrder'])
    router.get('/salon/customers', [SalonController, 'customers'])
    router.post('/salon/accounts/:id/dispatch', [SalonController, 'dispatch'])
    router.post('/salon/accounts/:id/deliver', [SalonController, 'deliver'])
    router.post('/salon/accounts/:id/customer', [SalonController, 'setCustomer'])
    router.get('/salon/menu', [SalonController, 'menu'])
    router.post('/salon/command', [SalonController, 'command'])
    router.get('/salon/accounts/:id', [SalonController, 'account'])
    router.post('/salon/accounts/:id/print', [SalonController, 'printAccount'])
    router.post('/salon/accounts/:id/reopen', [SalonController, 'reopen'])
    router.post('/salon/accounts/:id/pay', [SalonController, 'pay'])
    router.post('/salon/accounts/:id/reprint-note', [SalonController, 'reprintNote'])
    router.post('/salon/accounts/:id/reopen-paid', [SalonController, 'reopenPaid'])
    router.post('/salon/accounts/:id/cancel', [SalonController, 'cancel'])
    router.post('/salon/accounts/:id/move', [SalonController, 'move'])
    router.post('/salon/rounds/:roundId/reprint', [SalonController, 'reprintRound'])
    router.post('/salon/items/:itemId/void', [SalonController, 'voidItem'])
    router.post('/salon/items/:itemId/courtesy', [SalonController, 'courtesy'])
    router.post('/salon/items/serve', [SalonController, 'serve'])
    // Monitor de producción
    router.get('/salon/monitor', [SalonController, 'monitor'])
    router.post('/salon/monitor/items', [SalonController, 'monitorItems'])
    // Caja: apertura, movimientos, lo de los meseros, cortes X / Z y corte global
    router.get('/salon/cash', [SalonController, 'cashState'])
    router.post('/salon/cash/open', [SalonController, 'cashOpen'])
    router.post('/salon/cash/sessions/:id/movements', [SalonController, 'cashMovement'])
    router.post('/salon/cash/sessions/:id/collector', [SalonController, 'cashCollector'])
    router.post('/salon/cash/sessions/:id/x', [SalonController, 'cashX'])
    router.post('/salon/cash/sessions/:id/z', [SalonController, 'cashZ'])
    router.post('/salon/cash/close-shift', [SalonController, 'cashClose'])
    router.get('/salon/cash/history', [SalonController, 'cashHistory'])
    router.post('/salon/cash/shifts/:id/reprint', [SalonController, 'cashReprint'])
    // Central de impresión (solo dueño)
    router.get('/salon/print-queue', [SalonController, 'printQueue'])
    router.get('/salon/print-history', [SalonController, 'printHistory'])
    router.post('/salon/print-jobs/:jobId/result', [SalonController, 'printResult'])
    router.post('/salon/print-jobs/:jobId/reprint', [SalonController, 'reprint'])
    router.post('/salon/print-test', [SalonController, 'testPrint'])
    router.post('/salon/print-jobs/discard', [SalonController, 'discardJobs'])
    // Infraestructura (solo dueño)
    router.get('/salon/config', [SalonController, 'config'])
    router.put('/salon/settings', [SalonController, 'saveSettings'])
    router.post('/salon/pairing-code', [SalonController, 'rotatePairing'])
    router.put('/salon/devices/:id', [SalonController, 'saveDevice'])
    router.delete('/salon/devices/:id', [SalonController, 'deleteDevice'])
    router.post('/salon/registers', [SalonController, 'saveRegister'])
    router.put('/salon/registers/:id', [SalonController, 'saveRegister'])
    router.delete('/salon/registers/:id', [SalonController, 'deleteRegister'])
    router.post('/salon/series', [SalonController, 'saveSeries'])
    router.put('/salon/series/:id', [SalonController, 'saveSeries'])
    router.get('/salon/areas', [SalonController, 'areas'])
    router.post('/salon/areas', [SalonController, 'saveArea'])
    router.put('/salon/areas/:id', [SalonController, 'saveArea'])
    router.delete('/salon/areas/:id', [SalonController, 'deleteArea'])
    router.put('/salon/area-assignments', [SalonController, 'assignAreas'])
    router.post('/salon/printers', [SalonController, 'savePrinter'])
    router.put('/salon/printers/:id', [SalonController, 'savePrinter'])
    router.delete('/salon/printers/:id', [SalonController, 'deletePrinter'])
    router.post('/salon/dining-areas', [SalonController, 'saveDiningArea'])
    router.put('/salon/dining-areas/:id', [SalonController, 'saveDiningArea'])
    router.delete('/salon/dining-areas/:id', [SalonController, 'deleteDiningArea'])
    router.post('/salon/tables', [SalonController, 'saveTable'])
    router.post('/salon/tables/bulk', [SalonController, 'bulkTables'])
    router.put('/salon/tables/:id', [SalonController, 'saveTable'])
    router.delete('/salon/tables/:id', [SalonController, 'deleteTable'])
    router.post('/salon/staff', [SalonController, 'saveStaff'])
    router.put('/salon/staff/:id', [SalonController, 'saveStaff'])
    router.delete('/salon/staff/:id', [SalonController, 'deleteStaff'])
    router.get('/salon/authorizations', [SalonController, 'authorizationLog'])

    // Inventario del restaurante (función «insumos»)
    router.get('/stock/suppliers', [StockController, 'suppliers'])
    router.post('/stock/suppliers', [StockController, 'createSupplier'])
    router.get('/stock/purchases', [StockController, 'purchases'])
    router.post('/stock/purchases', [StockController, 'createPurchase'])
    router.post('/stock/purchases/:id/void', [StockController, 'voidPurchase'])
    router.get('/stock/preparations/:id', [StockController, 'components'])
    router.put('/stock/preparations/:id', [StockController, 'saveComponents'])
    router.post('/stock/preparations/:id/produce', [StockController, 'produce'])
    router.get('/stock/counts', [StockController, 'counts'])
    router.post('/stock/counts', [StockController, 'openCount'])
    router.get('/stock/counts/:id', [StockController, 'count'])
    router.put('/stock/counts/:id', [StockController, 'saveCount'])
    router.post('/stock/counts/:id/close', [StockController, 'closeCount'])
    router.delete('/stock/counts/:id', [StockController, 'discardCount'])
    router.get('/stock/movements', [StockController, 'movements'])
    router.get('/stock/reports', [StockController, 'reports'])

    // Proveedores y compras
    router.get('/suppliers', [SuppliersController, 'index'])
    router.post('/suppliers', [SuppliersController, 'store'])
    router.put('/suppliers/:id', [SuppliersController, 'update'])
    router.delete('/suppliers/:id', [SuppliersController, 'destroy'])

    router.get('/purchases', [PurchasesController, 'index'])
    router.get('/purchases/cost-history', [PurchasesController, 'costHistory'])
    router.get('/purchases/:id', [PurchasesController, 'show'])
    router.post('/purchases', [PurchasesController, 'store'])
    router.put('/purchases/:id', [PurchasesController, 'update'])
    router.post('/purchases/:id/confirm', [PurchasesController, 'confirm'])
    router.post('/purchases/:id/receipts', [PurchasesController, 'receipt'])
    router.post('/purchases/:id/receive', [PurchasesController, 'receive'])
    router.post('/purchases/:id/close', [PurchasesController, 'close'])
    router.post('/purchases/:id/cancel', [PurchasesController, 'cancel'])

    // Revisión de precios: sugiere, nunca cambia sin confirmar
    router.get('/price-reviews', [PriceReviewsController, 'index'])
    router.post('/price-reviews/:id/dismiss', [PriceReviewsController, 'dismiss'])
    router.get('/products/:id/price-suggestion', [PriceReviewsController, 'suggestion'])
    router.post('/products/:id/price', [PriceReviewsController, 'apply'])

    // Envíos propios y de compras
    router.get('/products/:id/gallery', [ProductGalleryController, 'show'])
    router.put('/products/:id/gallery', [ProductGalleryController, 'update'])
    router.get('/payment-methods', [PaymentMethodsController, 'index'])
    router.put('/payment-methods', [PaymentMethodsController, 'update'])
    router.get('/payment-proofs', [PaymentProofsController, 'index'])
    router.post('/payment-proofs/:id/validate', [PaymentProofsController, 'validate'])
    router.post('/payment-proofs/:id/reject', [PaymentProofsController, 'reject'])
    router.get('/shipments', [ShipmentsController, 'index'])
    router.get('/shipments/:id', [ShipmentsController, 'show'])
    router.post('/shipments', [ShipmentsController, 'store'])
    router.put('/shipments/:id', [ShipmentsController, 'update'])
    router.post('/shipments/:id/status', [ShipmentsController, 'status'])

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
    router.get('/plan', [MyPlanController, 'show'])
    router.get('/store-settings', [StoreSettingsController, 'show'])
    router.put('/store-settings', [StoreSettingsController, 'update'])

    // Descuentos
    router.get('/discounts', [DiscountsController, 'index'])
    router.post('/discounts', [DiscountsController, 'store'])
    router.put('/discounts/:id', [DiscountsController, 'update'])
    router.put('/discounts/:id/toggle', [DiscountsController, 'toggle'])
    router.delete('/discounts/:id', [DiscountsController, 'destroy'])
  })
  .prefix('/api/b/:businessUuid')
  .use([middleware.auth({ guards: ['api'] }), middleware.tenant()])
