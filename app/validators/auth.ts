import vine from '@vinejs/vine'

const password = vine.string().minLength(8)

const uniqueEmail = vine.string().email().normalizeEmail().unique(async (db, value) => {
  const match = await db.from('users').select('id').where('email', value).first()
  return !match
})

/**
 * Registro público. No acepta `rol_id`: el rol lo asigna el servidor
 * (siempre `admin`). Dejar que el cliente lo mande permitía que
 * cualquiera se creara una cuenta superadmin.
 */
export const registerValidator = vine.compile(
  vine.object({
    email: uniqueEmail,
    password,
    name: vine.string().minLength(3),
  })
)

/**
 * Alta de usuarios desde el panel. Solo la usa el superadmin, que sí
 * puede elegir el rol.
 */
export const createUserValidator = vine.compile(
  vine.object({
    email: uniqueEmail,
    password,
    name: vine.string().minLength(3),
    rol_id: vine.number().positive(),
    status: vine.enum(['activo', 'inactivo']).optional(),
  })
)

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail(),
    password: vine.string(),
  })
)

/**
 * Cambio de contraseña del propio usuario. Exige la contraseña actual y
 * no recibe `email`: el usuario sale del token, nunca del body.
 */
export const updatePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string(),
    newPassword: password.confirmed({ confirmationField: 'newPasswordConfirmation' }),
  })
)
