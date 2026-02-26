import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Role from '#models/role'
import User from '#models/user'

export default class InicioAppSeeder extends BaseSeeder {
  public async run() {
    // 🔹 Crear roles si no existen
    const rolesData = [{ name: 'superadmin' }, { name: 'admin' }]

    const roles = await Promise.all(
      rolesData.map(async (roleData) => {
        const role = await Role.firstOrCreate({ name: roleData.name }, roleData)
        return role
      })
    )

    const roleSuperAdmin = roles.find((r) => r.name === 'superadmin')!
    const roleAdmin = roles.find((r) => r.name === 'admin')!

    // 🔹 Crear usuarios asociados a los roles
    const usersData = [
      {
        name: 'Super Administrador',
        email: 'superadmin@app.com',
        password: 'super123',
        rolId: roleSuperAdmin.id,
        status: 'activo' as const,
      },
      {
        name: 'Administrador General',
        email: 'admin@app.com',
        password: 'admin123',
        rolId: roleAdmin.id,
        status: 'activo' as const,
      },
    ]

    for (const userData of usersData) {
      await User.firstOrCreate({ email: userData.email }, userData)
    }

    console.log('✅ Seeder "InicioAppSeeder" ejecutado con éxito.')
  }
}
