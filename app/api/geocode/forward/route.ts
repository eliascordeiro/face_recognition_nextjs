import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

const HEADERS = {
  'User-Agent': 'controle-de-obras-app/1.0 (uso interno, cadastro de obras)',
  'Accept-Language': 'pt-BR',
}

interface NominatimResult {
  lat: string
  lon: string
  address?: Record<string, string>
}

function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase().trim()
}

async function nominatim(params: URLSearchParams): Promise<NominatimResult | null> {
  params.set('addressdetails', '1')
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error('Falha ao consultar serviço de geocodificação')
  const data = await res.json()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/** Confere se a cidade retornada pelo Nominatim bate com a cidade digitada
 *  pelo usuário — evita aceitar um resultado de outra região/estado quando a
 *  busca por rua não encontra o logradouro exato e o serviço "adivinha"
 *  um lugar qualquer com nome parecido. */
function cityMatches(result: NominatimResult, city: string): boolean {
  if (!city) return true
  const addr = result.address ?? {}
  const candidates = [addr.city, addr.town, addr.village, addr.municipality, addr.county]
    .filter(Boolean)
    .map((c) => normalize(c as string))
  return candidates.some((c) => c.includes(normalize(city)) || normalize(city).includes(c))
}

// GET /api/geocode/forward — busca coordenadas aproximadas a partir de um
// endereço, usado como complemento ao CEP (não substitui a precisão do GPS
// capturado no local).
//
// Prioriza uma busca ESTRUTURADA (street/city/state/postalcode), que é bem
// mais precisa no Nominatim do que uma busca livre — evita cair no "centro"
// da cidade quando número/rua são informados. Se a busca estruturada não
// encontrar nada (ex.: endereço muito novo), tenta como busca livre (`q`)
// e, em último caso, apenas pelo CEP.
//
// `precision` no retorno indica o nível de confiança do resultado:
//  - "street": encontrou a rua/número informados
//  - "cep":    encontrou apenas pela região do CEP/cidade (menos preciso)
//  - "free":   busca livre, resultado pode não corresponder exatamente
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const street = (searchParams.get('street') ?? '').trim()
    const number = (searchParams.get('number') ?? '').trim()
    const city = (searchParams.get('city') ?? '').trim()
    const state = (searchParams.get('state') ?? '').trim()
    const cep = (searchParams.get('cep') ?? '').replace(/\D/g, '')
    const q = (searchParams.get('q') ?? '').trim()

    let best: NominatimResult | null = null
    let precision: 'street' | 'cep' | 'free' | null = null

    // 1) Busca estruturada com rua + número (mais precisa)
    if (street && city) {
      const structured = new URLSearchParams({
        format: 'jsonv2',
        street: [number, street].filter(Boolean).join(' '),
        city,
        country: 'Brazil',
        limit: '1',
      })
      if (state) structured.set('state', state)
      if (cep) structured.set('postalcode', cep)
      const result = await nominatim(structured)
      if (result && cityMatches(result, city)) {
        best = result
        precision = 'street'
      }
    }

    // 2) Sem número/rua reconhecido: tenta pelo menos CEP + cidade (estruturado)
    if (!best && cep) {
      const byCep = new URLSearchParams({
        format: 'jsonv2', postalcode: cep, country: 'Brazil', limit: '1',
      })
      if (city) byCep.set('city', city)
      if (state) byCep.set('state', state)
      const result = await nominatim(byCep)
      if (result && cityMatches(result, city)) {
        best = result
        precision = 'cep'
      }
    }

    // 3) Fallback: busca livre (texto único) — só aceita se a cidade bater
    if (!best && q.length >= 5) {
      const free = new URLSearchParams({ format: 'jsonv2', q, countrycodes: 'br', limit: '1' })
      const result = await nominatim(free)
      if (result && cityMatches(result, city)) {
        best = result
        precision = 'free'
      }
    }

    if (!best) return NextResponse.json({ lat: null, lng: null, precision: null })
    return NextResponse.json({ lat: parseFloat(best.lat), lng: parseFloat(best.lon), precision })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

