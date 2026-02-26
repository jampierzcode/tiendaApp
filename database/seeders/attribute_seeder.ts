import ProductAttribute from '#models/product_attribute'
import ProductAttributeValue from '#models/product_attribute_value'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class extends BaseSeeder {
  async run() {
    // Write your database queries inside the run method
    await ProductAttribute.createMany([
      { name: 'Talla', type: 'size', isRequired: true, isFilterable: true, businessId: 1 },
      { name: 'Color', type: 'color', isRequired: true, isFilterable: true, businessId: 1 },
      { name: 'Material', type: 'text', isRequired: false, isFilterable: true, businessId: 1 },
      { name: 'Género', type: 'select', isRequired: true, isFilterable: true, businessId: 1 },
      { name: 'Estilo', type: 'text', isRequired: false, isFilterable: false, businessId: 1 },
    ])
    await ProductAttributeValue.createMany([
      { attributeId: 1, value: 'S' },
      { attributeId: 1, value: 'M' },
      { attributeId: 1, value: 'L' },
      { attributeId: 2, value: 'Rojo', hexColor: '#FF0000' },
      { attributeId: 2, value: 'Negro', hexColor: '#000000' },
      { attributeId: 4, value: 'Hombre' },
      { attributeId: 4, value: 'Mujer' },
    ])
  }
}
