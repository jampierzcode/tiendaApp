/**
 * Opciones elegidas de un plato, agrupadas por grupo para cocina y para la
 * cuenta: «Presa: Pierna», «Cremas: Mayonesa, Ají». En un combo, ver solo
 * «Pierna, Arroz chaufa, Limonada» no dice qué es la bebida y qué el acompañamiento.
 */
export function opcionesAgrupadas(
  modifiers: { groupName: string; optionName: string; quantity: number }[]
) {
  const grupos = new Map<string, string[]>()
  for (const m of modifiers) {
    const nombre = m.quantity > 1 ? `${m.quantity}x ${m.optionName}` : m.optionName
    grupos.set(m.groupName, [...(grupos.get(m.groupName) ?? []), nombre])
  }
  return [...grupos].map(([grupo, opciones]) => `${grupo}: ${opciones.join(', ')}`)
}
