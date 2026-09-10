import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Role from '#models/role'
import User from '#models/user'

export default class InicioAppSeeder extends BaseSeeder {
  public async run() {
    // 🔹 Crear roles si no existen
    const rolesData = [{ name: 'superadmin' }, { name: 'admin' }]

    // En serie a propósito: con Promise.all los roles se insertaban a la vez
    // y los ids salían en orden distinto en cada instalación.
    const roles: Role[] = []
    for (const roleData of rolesData) {
      roles.push(await Role.firstOrCreate({ name: roleData.name }, roleData))
    }

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
