import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

const VALID_STATUS = ['planning', 'in_progress', 'paused', 'completed']

// GET /api/obras — lista obras do cliente autenticado (com contagem de funcionários alocados)
export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.description, o.status, o.start_date, o.address, o.lat, o.lng, o.created_at,
              COUNT(p.id)::int AS employee_count
       FROM obras o
       LEFT JOIN persons p ON p.obra_id = o.id
       WHERE o.client_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
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

    const { name, description, status, startDate, address, lat, lng } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome da obra é obrigatório (mín. 2 caracteres)' }, { status: 422 })
    }
    const cleanStatus = VALID_STATUS.includes(status) ? status : 'planning'

    const { rows } = await pool.query(
      `INSERT INTO obras (name, description, status, start_date, address, lat, lng, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, description, status, start_date, address, lat, lng, created_at, 0 AS employee_count`,
      [
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        cleanStatus,
        typeof startDate === 'string' && startDate ? startDate : null,
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
