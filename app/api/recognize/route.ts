import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { getRecognizeFaceThreshold, toFaceConfidencePercent } from '@/lib/faceRecognition'

const RECOGNIZE_THRESHOLD = getRecognizeFaceThreshold()

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
       WHERE client_id = $2 AND embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT 1`,
      [vectorStr, auth.clientId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ match: false })
    }

    const { id, name, distance } = result.rows[0]
    const dist = parseFloat(distance)
    const match = dist < RECOGNIZE_THRESHOLD
    const confidence = toFaceConfidencePercent(dist, RECOGNIZE_THRESHOLD)

    console.info(
      `[recognize] client=${auth.clientId} person=${id} match=${match} distance=${dist.toFixed(4)} threshold=${RECOGNIZE_THRESHOLD.toFixed(4)} confidence=${confidence}`
    )

    return NextResponse.json({
      match,
      person_id: match ? id : null,
      name: match ? name : null,
      distance: Math.round(dist * 10000) / 10000,
      threshold: Number(RECOGNIZE_THRESHOLD.toFixed(4)),
      confidence: match ? confidence : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
