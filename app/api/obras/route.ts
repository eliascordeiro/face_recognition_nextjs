import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

// GET /api/obras — lista obras do cliente autenticado
export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { rows } = await pool.query(
      `SELECT id, name, address, lat, lng, created_at
       FROM obras WHERE client_id = $1 ORDER BY created_at DESC`,
      [auth.clientId]
    )
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST /api/obras — cadastra nova obra
export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { name, address, lat, lng } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome da obra é obrigatório (mín. 2 caracteres)' }, { status: 422 })
    }

    const { rows } = await pool.query(
      `INSERT INTO obras (name, address, lat, lng, client_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, address, lat, lng, created_at`,
      [
        name.trim(),
        typeof address === 'string' ? address.trim() || null : null,
        typeof lat === 'number' && isFinite(lat) ? lat : null,
        typeof lng === 'number' && isFinite(lng) ? lng : null,
        auth.sub,
      ]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
