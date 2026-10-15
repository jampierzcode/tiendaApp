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

const businessShape = {
  name: vine.string().trim().minLength(2).maxLength(120),
  business_type: vine.enum(['retail', 'restaurant']),
  /** Clave de plantilla de catálogo; vacío = empezar sin productos. */
  template: vine.string().trim().optional(),
  whatsapp_phone: vine
    .string()
    .trim()
    .regex(/^\d{8,15}$/),
  city: vine.string().trim().maxLength(80).optional(),
  address: vine.string().trim().maxLength(200).optional(),
  schedule: vine.string().trim().maxLength(120).optional(),
  description: vine.string().trim().maxLength(300).optional(),
  primary_color: vine.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondary_color: vine.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}

/**
 * Suscripción pública (wizard): crea el dueño y su primer negocio de una vez.
 * El rol y el estado de la prueba los fija el servidor.
 */
export const subscribeValidator = vine.compile(
  vine.object({
    owner: vine.object({
      name: vine.string().trim().minLength(3).maxLength(120),
      email: uniqueEmail,
      // Instancia propia: `password.confirmed()` de arriba muta el esquema compartido.
      password: vine.string().minLength(8),
    }),
    business: vine.object(businessShape),
  })
)

/** Un usuario ya registrado agrega otro negocio a su cuenta. */
export const addBusinessValidator = vine.compile(vine.object(businessShape))
