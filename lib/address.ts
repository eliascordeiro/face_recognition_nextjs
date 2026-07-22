/** Compõe um endereço textual a partir dos campos estruturados (usado para
 *  exibição e link do Google Maps). Retorna null se nada foi preenchido. */
export function composeAddress(parts: {
  street?: string | null
  number?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
}): string | null {
  const streetLine = [parts.street, parts.number].filter(Boolean).join(', ')
  const cityLine = [parts.city, parts.state].filter(Boolean).join(' - ')
  const segments = [streetLine, parts.neighborhood, cityLine].filter(Boolean)
  if (parts.cep) segments.push(`CEP ${parts.cep}`)
  return segments.length > 0 ? segments.join(', ') : null
}

export function cleanCep(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length !== 8) return null
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function cleanStr(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().slice(0, maxLen)
  return v || null
}

export function cleanState(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase().slice(0, 2)
  return /^[A-Z]{2}$/.test(v) ? v : null
}
