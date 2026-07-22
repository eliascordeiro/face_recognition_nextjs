import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

// GET /api/geocode/forward?q=<endereço> — busca coordenadas aproximadas a
// partir de um endereço textual (usado após preencher o CEP, como
// complemento — não substitui a precisão do GPS capturado no local).
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') ?? '').trim()
    if (q.length < 5) {
      return NextResponse.json({ error: 'Endereço muito curto para busca' }, { status: 422 })
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=br&limit=1`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'controle-de-obras-app/1.0 (uso interno, cadastro de obras)',
        'Accept-Language': 'pt-BR',
      },
    })
    if (!res.ok) throw new Error('Falha ao consultar serviço de geocodificação')
    const data = await res.json()

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ lat: null, lng: null })
    }

    return NextResponse.json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
