/** Integração com a Mapbox Geocoding API v6 — usada como provedor principal
 *  de geocodificação (mais completa para números de porta no Brasil do que
 *  o OpenStreetMap/Nominatim puro). Requer a variável de ambiente
 *  MAPBOX_TOKEN (ou NEXT_PUBLIC_MAPBOX_TOKEN, reaproveitando um token já
 *  existente em outro projeto). Se não configurada, as rotas de geocode
 *  caem automaticamente no fallback via Nominatim (gratuito, sem token).
 *
 *  Docs: https://docs.mapbox.com/api/search/geocoding-v6/
 */

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

export function hasMapboxToken(): boolean {
  return MAPBOX_TOKEN.length > 0
}

export type GeoPrecision = 'house' | 'street' | 'approx'

export interface MapboxForwardResult {
  lat: number
  lng: number
  precision: GeoPrecision
  matchedNumber: string | null
}

export interface MapboxReverseResult {
  address: string | null
  precision: 'house' | 'street'
  street: string
  houseNumber: string
  neighbourhood: string
  city: string
  state: string
  postcode: string
}

interface MapboxContextEntry { name?: string; region_code?: string }
interface MapboxFeature {
  properties: {
    full_address?: string
    name?: string
    address_number?: string
    street?: string
    context?: {
      neighborhood?: MapboxContextEntry
      place?: MapboxContextEntry
      region?: MapboxContextEntry
      postcode?: MapboxContextEntry
    }
    match_code?: {
      house_number?: 'matched' | 'not_matched' | 'unknown'
      confidence?: 'exact' | 'high' | 'medium' | 'low'
    }
  }
  geometry: { coordinates: [number, number] }
}

async function mapboxFetch(url: string): Promise<{ features: MapboxFeature[] } | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json()
}

/** Busca coordenadas a partir de um endereço estruturado (forward geocoding). */
export async function mapboxForward(params: {
  street: string
  number: string
  city: string
  state: string
  cep: string
}): Promise<MapboxForwardResult | null> {
  if (!hasMapboxToken()) return null
  const addressLine1 = [params.number, params.street].filter(Boolean).join(' ').trim()
  if (!addressLine1) return null

  const qs = new URLSearchParams({
    address_line1: addressLine1,
    country: 'BR',
    language: 'pt',
    limit: '1',
    access_token: MAPBOX_TOKEN,
  })
  if (params.city) qs.set('place', params.city)
  if (params.state) qs.set('region', params.state)
  if (params.cep) qs.set('postcode', params.cep)

  try {
    const data = await mapboxFetch(`https://api.mapbox.com/search/geocode/v6/forward?${qs.toString()}`)
    const feature = data?.features?.[0]
    if (!feature) return null

    const [lng, lat] = feature.geometry.coordinates
    const houseMatch = feature.properties.match_code?.house_number
    const matchedNumber = feature.properties.address_number ?? null
    const precision: GeoPrecision = houseMatch === 'matched' ? 'house' : 'street'

    return { lat, lng, precision, matchedNumber }
  } catch {
    return null
  }
}

/** Busca o endereço a partir de coordenadas GPS (reverse geocoding). */
export async function mapboxReverse(lat: number, lng: number): Promise<MapboxReverseResult | null> {
  if (!hasMapboxToken()) return null

  const qs = new URLSearchParams({
    longitude: String(lng),
    latitude: String(lat),
    language: 'pt',
    limit: '1',
    access_token: MAPBOX_TOKEN,
  })

  try {
    const data = await mapboxFetch(`https://api.mapbox.com/search/geocode/v6/reverse?${qs.toString()}`)
    const feature = data?.features?.[0]
    if (!feature) return null

    const p = feature.properties
    const ctx = p.context ?? {}
    const houseNumber = p.address_number ?? ''
    const street = p.street ?? ''
    const neighbourhood = ctx.neighborhood?.name ?? ''
    const city = ctx.place?.name ?? ''
    const state = ctx.region?.region_code ?? ctx.region?.name ?? ''
    const postcode = ctx.postcode?.name ?? ''

    return {
      address: p.full_address ?? null,
      precision: houseNumber ? 'house' : 'street',
      street, houseNumber, neighbourhood, city, state, postcode,
    }
  } catch {
    return null
  }
}
