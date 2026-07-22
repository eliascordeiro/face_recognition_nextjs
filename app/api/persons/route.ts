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
      `SELECT id, name, phone, email, document, role, active, thumbnail, created_at,
              (embedding IS NOT NULL) AS has_face
       FROM persons WHERE client_id = $1 ORDER BY created_at DESC`,
      [auth.clientId]
    )
    return NextResponse.json(rows)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST /api/persons — cadastra funcionário vinculado ao cliente
// O reconhecimento facial (embedding) é opcional neste momento: pode ser
// cadastrado depois, através do botão "Reconhecimento facial" na listagem.
export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { name, phone, email, document, role, embedding, thumbnail } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 255) {
      return NextResponse.json({ error: 'Nome inválido (2–255 caracteres)' }, { status: 422 })
    }

    const vectorStr = embedding != null ? `[${parseEmbedding(embedding).join(',')}]` : null
    const cleanPhone = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(0, 11) || null : null
    const cleanDocument = typeof document === 'string' ? document.replace(/\D/g, '').slice(0, 14) || null : null
    const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().slice(0, 255) : null
    const cleanRole = typeof role === 'string' && role.trim() ? role.trim().slice(0, 100) : null

    const { rows } = await pool.query(
      `INSERT INTO persons (name, phone, email, document, role, embedding, thumbnail, client_id)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
       RETURNING id, name, phone, email, document, role, active, created_at, (embedding IS NOT NULL) AS has_face`,
      [name.trim(), cleanPhone, cleanEmail, cleanDocument, cleanRole, vectorStr, typeof thumbnail === 'string' ? thumbnail : null, auth.clientId]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

