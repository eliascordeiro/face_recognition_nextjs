import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

// Distância L2 máxima para confirmar match.
// face-api.js produz descritores normalizados — limiar típico: 0.6
const MATCH_THRESHOLD = 0.6

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) {
    throw new Error('embedding deve ser um array de 128 números')
  }
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) {
    throw new Error('embedding contém valores não numéricos')
  }
  return raw as number[]
}

// ── POST /api/recognize ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const emb = parseEmbedding(body.embedding)
    const vectorStr = `[${emb.join(',')}]`

    // pgvector: operador <-> = distância L2; índice HNSW acelera a busca
    const result = await pool.query(
      `SELECT id, name, (embedding <-> $1::vector) AS distance
       FROM persons
       WHERE client_id = $2
       ORDER BY distance ASC
       LIMIT 1`,
      [vectorStr, auth.clientId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ match: false })
    }

    const { id, name, distance } = result.rows[0]
    const dist = parseFloat(distance)
    const match = dist < MATCH_THRESHOLD
    const confidence = match
      ? Math.max(0, Math.round((1 - dist / MATCH_THRESHOLD) * 100))
      : 0

    return NextResponse.json({
      match,
      person_id: match ? id : null,
      name: match ? name : null,
      distance: Math.round(dist * 10000) / 10000,
      confidence: match ? confidence : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
