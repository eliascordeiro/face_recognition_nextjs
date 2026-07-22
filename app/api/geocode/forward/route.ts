import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

const HEADERS = {
  'User-Agent': 'controle-de-obras-app/1.0 (uso interno, cadastro de obras)',
  'Accept-Language': 'pt-BR',
}

async function nominatim(params: URLSearchParams) {
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error('Falha ao consultar serviço de geocodificação')
  const data = await res.json()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
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

    let best: { lat: string; lon: string } | null = null

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
      best = await nominatim(structured)
    }

    // 2) Sem número/rua reconhecido: tenta pelo menos CEP + cidade (estruturado)
    if (!best && cep) {
      const byCep = new URLSearchParams({
        format: 'jsonv2', postalcode: cep, country: 'Brazil', limit: '1',
      })
      if (city) byCep.set('city', city)
      if (state) byCep.set('state', state)
      best = await nominatim(byCep)
    }

    // 3) Fallback: busca livre (texto único)
    if (!best && q.length >= 5) {
      const free = new URLSearchParams({ format: 'jsonv2', q, countrycodes: 'br', limit: '1' })
      best = await nominatim(free)
    }

    if (!best) return NextResponse.json({ lat: null, lng: null })
    return NextResponse.json({ lat: parseFloat(best.lat), lng: parseFloat(best.lon) })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

