import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) throw new Error('embedding deve ser um array de 128 números')
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) throw new Error('embedding contém valores não numéricos')
  return raw as number[]
}

// GET /api/persons — lista funcionários do cliente autenticado
export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { rows } = await pool.query(
      `SELECT id, name, phone, thumbnail, created_at FROM persons WHERE client_id = $1 ORDER BY created_at DESC`,
      [auth.clientId]
    )
    return NextResponse.json(rows)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST /api/persons — cadastra funcionário vinculado ao cliente
export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { name, phone, embedding, thumbnail } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 255) {
      return NextResponse.json({ error: 'Nome inválido (2–255 caracteres)' }, { status: 422 })
    }

    const emb = parseEmbedding(embedding)
    const vectorStr = `[${emb.join(',')}]`
    const cleanPhone = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(0, 11) || null : null

    const { rows } = await pool.query(
      `INSERT INTO persons (name, phone, embedding, thumbnail, client_id)
       VALUES ($1, $2, $3::vector, $4, $5)
       RETURNING id, name, phone, created_at`,
      [name.trim(), cleanPhone, vectorStr, typeof thumbnail === 'string' ? thumbnail : null, auth.clientId]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
