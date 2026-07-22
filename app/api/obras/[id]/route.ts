import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

const VALID_STATUS = ['planning', 'in_progress', 'paused', 'completed']

// GET /api/obras/[id] — detalhe da obra + funcionários alocados
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { id } = await params
    const { rows } = await pool.query(
      `SELECT id, name, description, status, start_date, address, lat, lng, created_at
       FROM obras WHERE id = $1 AND client_id = $2`,
      [Number(id), auth.clientId]
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })

    const { rows: employees } = await pool.query(
      `SELECT id, name, role, phone, thumbnail, (embedding IS NOT NULL) AS has_face
       FROM persons WHERE obra_id = $1 AND client_id = $2 ORDER BY name`,
      [Number(id), auth.clientId]
    )
    return NextResponse.json({ ...rows[0], employees })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PATCH /api/obras/[id] — atualiza obra
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    const { name, description, status, startDate, address, lat, lng } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome da obra é obrigatório' }, { status: 422 })
    }
    const cleanStatus = VALID_STATUS.includes(status) ? status : 'planning'

    const { rows, rowCount } = await pool.query(
      `UPDATE obras SET name = $1, description = $2, status = $3, start_date = $4, address = $5, lat = $6, lng = $7
       WHERE id = $8 AND client_id = $9
       RETURNING id, name, description, status, start_date, address, lat, lng, created_at`,
      [
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        cleanStatus,
        typeof startDate === 'string' && startDate ? startDate : null,
        typeof address === 'string' ? address.trim() || null : null,
        typeof lat === 'number' && isFinite(lat) ? lat : null,
        typeof lng === 'number' && isFinite(lng) ? lng : null,
        Number(id),
        auth.sub,
      ]
    )
    if (rowCount === 0) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE /api/obras/[id] — remove obra
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    const { rowCount } = await pool.query(
      `DELETE FROM obras WHERE id = $1 AND client_id = $2`,
      [Number(id), auth.sub]
    )
    if (rowCount === 0) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
