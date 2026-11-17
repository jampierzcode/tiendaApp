import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Preguntas frecuentes por producto (JSON: [{ pregunta, respuesta }]). El
 * vendedor IA las recibe en `ver_producto` para contestar detalles que no
 * están en la descripción (garantía, medidas, compatibilidad…).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('products', (table) => {
      table.text('ai_faqs').nullable()
    })
  }

  async down() {
    this.schema.alterTable('products', (table) => {
      table.dropColumn('ai_faqs')
    })
  }
}
