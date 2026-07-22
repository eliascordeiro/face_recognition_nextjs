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

/** Número de porta realmente encontrado no resultado (pode ser diferente do
 *  pedido: o OSM nem sempre tem cada número mapeado individualmente — nesse
 *  caso o Nominatim retorna o ponto conhecido mais próximo na mesma rua,
 *  por interpolação). */
function resultHouseNumber(result: NominatimResult): string | null {
  return result.address?.house_number ?? null
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
//  - "street":         encontrou a rua E o número exatos
//  - "street_approx":  encontrou a rua, mas o número retornado é diferente
//                      do informado (OSM não tem esse número mapeado —
//                      o ponto é interpolado/aproximado na mesma rua)
//  - "cep":            encontrou apenas pela região do CEP/cidade (menos preciso)
//  - "free":           busca livre, resultado pode não corresponder exatamente
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
    let precision: 'street' | 'street_approx' | 'cep' | 'free' | null = null
    let matchedNumber: string | null = null

    // 1) Busca estruturada com rua + número (mais precisa). A cidade ajuda a
    // desambiguar, mas não é obrigatória quando já temos o CEP (que também
    // localiza a região) — importante para buscar assim que CEP + rua/número
    // forem preenchidos, mesmo antes do campo Cidade ser confirmado.
    if (street && (city || cep)) {
      const structured = new URLSearchParams({
        format: 'jsonv2',
        street: [number, street].filter(Boolean).join(' '),
        country: 'Brazil',
        limit: '1',
      })
      if (city) structured.set('city', city)
      if (state) structured.set('state', state)
      if (cep) structured.set('postalcode', cep)
      const result = await nominatim(structured)
      if (result && cityMatches(result, city)) {
        best = result
        const foundNumber = resultHouseNumber(result)
        matchedNumber = foundNumber
        // Se um número foi pedido, só é "street" (alta confiança) quando o
        // OSM realmente tem ESSE número mapeado (addresstype 'house'/'building').
        // Sem casa mapeada (ex.: Nominatim só achou a via, sem house_number —
        // caso comum em ruas/rodovias com poucos endereços no OpenStreetMap),
        // ou com um número diferente do pedido, o ponto é aproximado.
        precision = !number || foundNumber === number ? 'street' : 'street_approx'
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
    return NextResponse.json({
      lat: parseFloat(best.lat),
      lng: parseFloat(best.lon),
      precision,
      matchedNumber: precision === 'street_approx' ? matchedNumber : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

