/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
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

router.get('/', async () => {
  return {
    hello: 'world',
  }
})
router.post('/api/register', [AuthController, 'register']).as('auth.register')
router.post('/api/newuser', [AuthController, 'createUser']).as('auth.createUser')

router.post('/api/login', [AuthController, 'login']).as('auth.login')

// Grupo protegido
router
  .group(() => {
    router.delete('/logout', [AuthController, 'logout']).as('auth.logout').use(middleware.auth())
    router.post('/updatePassword', [AuthController, 'updatePassword']).as('auth.updatePassword')
    router.get('/me', [AuthController, 'me']).as('auth.me')

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

    router.get('/businesses', [BusinessesController, 'index']).as('business.index')
    router
      .get('/businesses/byUuid/:uuid', [BusinessesController, 'getByUuid'])
      .as('business.byUuid')
    router.get('/businesses/byUser', [BusinessesController, 'getByUser']).as('business.byUser')
    router.get('/businesses/:id', [BusinessesController, 'show']).as('business.show')
    router.post('/businesses', [BusinessesController, 'store']).as('business.store')
    router.put('/businesses/:id', [BusinessesController, 'update']).as('business.update')
    router.delete('/businesses/:id', [BusinessesController, 'destroy']).as('business.destroy')
    // PRODUCTS ROUTES
    router.get('/products', [ProductsController, 'index']).as('products.index')
    router
      .get('/products/byBusiness/:businessId', [ProductsController, 'getByBusiness'])
      .as('products.byBusiness')

    router.get('/products/:id', [ProductsController, 'show']).as('products.show')
    router.post('/products', [ProductsController, 'store']).as('products.store')
    router.put('/products/:id', [ProductsController, 'update']).as('products.update')
    router.delete('/products/:id', [ProductsController, 'destroy']).as('products.destroy')

    // BUSINESS IMAGES ROUTES
    router.get('/business-images', [BusinessImagesController, 'index']).as('business-image.index')
    router
      .get('/business-images/byBusiness/:businessId', [BusinessImagesController, 'getByBusiness'])
      .as('business-image.byBusiness')

    router.post('/business-images', [BusinessImagesController, 'store']).as('business-image.store')
    router
      .put('/business-images/:id', [BusinessImagesController, 'update'])
      .as('business-image.update')
    router
      .delete('/business-images/:id', [BusinessImagesController, 'destroy'])
      .as('business-image.destroy')

    // CATEGORIES ROUTES
    router.get('/categories', [CategoriesController, 'index']).as('category.index')
    router
      .get('/categories/byBusiness/:businessId', [CategoriesController, 'getByBusiness'])
      .as('category.byBusiness')

    router.get('/categories/:id', [CategoriesController, 'show']).as('category.show')
    router.post('/categories', [CategoriesController, 'store']).as('category.store')
    router.put('/categories/:id', [CategoriesController, 'update']).as('category.update')
    router.delete('/categories/:id', [CategoriesController, 'destroy']).as('category.destroy')

    // SUBCATEGORIES ROUTES
    router.get('/subcategories', [SubcategoriesController, 'index']).as('subcategory.index')
    router
      .get('/subcategories/byBusiness/:businessId', [SubcategoriesController, 'getByBusiness'])
      .as('subcategory.byBusiness')

    router.get('/subcategories/:id', [SubcategoriesController, 'show']).as('subcategory.show')
    router.post('/subcategories', [SubcategoriesController, 'store']).as('subcategory.store')
    router.put('/subcategories/:id', [SubcategoriesController, 'update']).as('subcategory.update')
    router
      .delete('/subcategories/:id', [SubcategoriesController, 'destroy'])
      .as('subcategory.destroy')

    // 🟢 Category Products
    router
      .get('/category-products', [CategoryProductsController, 'index'])
      .as('categoryProducts.index')
    // router
    //   .get('/category-products/:id', [CategoryProductsController, 'show'])
    //   .as('categoryProducts.show')
    router
      .post('/category-products', [CategoryProductsController, 'store'])
      .as('categoryProducts.store')
    // router
    //   .put('/category-products/:id', [CategoryProductsController, 'update'])
    //   .as('categoryProducts.update')
    router
      .delete('/category-products/:id', [CategoryProductsController, 'destroy'])
      .as('categoryProducts.destroy')

    // 🟢 Product Attributes
    router
      .get('/product-attributes', [ProductAttributesController, 'index'])
      .as('productAttributes.index')
    router
      .get('/product-attributes/:id', [ProductAttributesController, 'show'])
      .as('productAttributes.show')
    router
      .post('/product-attributes', [ProductAttributesController, 'store'])
      .as('productAttributes.store')
    router
      .put('/product-attributes/:id', [ProductAttributesController, 'update'])
      .as('productAttributes.update')
    router
      .delete('/product-attributes/:id', [ProductAttributesController, 'destroy'])
      .as('productAttributes.destroy')

    // 🟢 Product Attribute Values
    router
      .get('/product-attribute-values', [ProductAttributeValuesController, 'index'])
      .as('productAttributeValues.index')
    // router
    //   .get('/product-attribute-values/:id', [ProductAttributeValuesController, 'show'])
    //   .as('productAttributeValues.show')
    router
      .post('/product-attribute-values', [ProductAttributeValuesController, 'store'])
      .as('productAttributeValues.store')
    // router
    //   .put('/product-attribute-values/:id', [ProductAttributeValuesController, 'update'])
    //   .as('productAttributeValues.update')
    router
      .delete('/product-attribute-values/:id', [ProductAttributeValuesController, 'destroy'])
      .as('productAttributeValues.destroy')

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

    router.get('/discounts', [DiscountsController, 'index']).as('discount.index')
    router.post('/discounts', [DiscountsController, 'store']).as('discount.store')
    router.put('/discounts/:id', [DiscountsController, 'update']).as('discount.update')
    router.delete('/discounts/:id', [DiscountsController, 'destroy']).as('discount.destroy')
  })
  .prefix('/api')
  .use(middleware.auth({ guards: ['api'] }))
