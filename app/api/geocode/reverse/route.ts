import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

// GET /api/geocode/reverse?lat=..&lng=.. — geocodificação reversa (GPS → endereço)
// Faz proxy para o Nominatim (OpenStreetMap) no servidor, evitando problemas de
// CORS no navegador e respeitando a política de uso (User-Agent identificado).
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const lat = parseFloat(searchParams.get('lat') ?? '')
    const lng = parseFloat(searchParams.get('lng') ?? '')
    if (!isFinite(lat) || !isFinite(lng)) {
      return NextResponse.json({ error: 'lat/lng inválidos' }, { status: 422 })
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'controle-de-obras-app/1.0 (uso interno, cadastro de obras)',
        'Accept-Language': 'pt-BR',
      },
    })
    if (!res.ok) throw new Error('Falha ao consultar serviço de geocodificação')
    const data = await res.json()

    if (data.error) {
      return NextResponse.json({ address: null })
    }

    const a = data.address ?? {}
    const street = a.road || a.pedestrian || a.street || ''
    const houseNumber = a.house_number || ''
    const neighbourhood = a.suburb || a.neighbourhood || a.quarter || ''
    const city = a.city || a.town || a.village || a.municipality || ''
    const state = a.state_code || a.state || ''

    const parts = [
      [street, houseNumber].filter(Boolean).join(', '),
      neighbourhood,
      [city, state].filter(Boolean).join(' - '),
    ].filter(Boolean)

    return NextResponse.json({
      address: parts.join(', ') || data.display_name || null,
      // "house": o GPS caiu sobre um ponto com número de porta mapeado no
      // OpenStreetMap (endereço completo confirmado). "street": só a rua foi
      // identificada — o OSM não tem o número exato dessa posição mapeado
      // (comum em rodovias/áreas rurais); o campo Número deve ser mantido
      // conforme informado pelo usuário.
      precision: houseNumber ? 'house' : 'street',
      raw: {
        street, houseNumber, neighbourhood, city, state,
        postcode: a.postcode || '',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
