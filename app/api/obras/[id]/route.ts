import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { composeAddress, cleanCep, cleanStr, cleanState } from '@/lib/address'
import { hasCapability } from '@/lib/permissions'

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
    if (!hasCapability(auth, 'obras.view')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    // Operador vinculado a uma obra só pode ver a própria
    if (auth.role === 'operator' && auth.obraId && auth.obraId !== id) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { rows } = await pool.query(
      `SELECT id, name, description, status, start_date,
              cep, street, number, neighborhood, city, state,
              address, lat, lng, created_at
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
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    if (!hasCapability(auth, 'obras.manage')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    if (auth.role === 'operator' && auth.obraId && auth.obraId !== id) {
      return NextResponse.json({ error: 'Acesso negado — fora do escopo da sua obra' }, { status: 403 })
    }
    const body = await request.json()
    const { name, description, status, startDate, lat, lng } = body

    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome da obra é obrigatório' }, { status: 422 })
    }
    const cleanStatus = VALID_STATUS.includes(status) ? status : 'planning'

    const cep = cleanCep(body.cep)
    const street = cleanStr(body.street, 255)
    const number = cleanStr(body.number, 20)
    const neighborhood = cleanStr(body.neighborhood, 150)
    const city = cleanStr(body.city, 150)
    const state = cleanState(body.state)
    const address = composeAddress({ cep, street, number, neighborhood, city, state })

    const { rows, rowCount } = await pool.query(
      `UPDATE obras SET name = $1, description = $2, status = $3, start_date = $4,
              cep = $5, street = $6, number = $7, neighborhood = $8, city = $9, state = $10,
              address = $11, lat = $12, lng = $13
       WHERE id = $14 AND client_id = $15
       RETURNING id, name, description, status, start_date, cep, street, number, neighborhood, city, state, address, lat, lng, created_at`,
      [
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        cleanStatus,
        typeof startDate === 'string' && startDate ? startDate : null,
        cep, street, number, neighborhood, city, state, address,
        typeof lat === 'number' && isFinite(lat) ? lat : null,
        typeof lng === 'number' && isFinite(lng) ? lng : null,
        Number(id),
        auth.clientId,
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
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    if (!hasCapability(auth, 'obras.manage')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    if (auth.role === 'operator' && auth.obraId && auth.obraId !== id) {
      return NextResponse.json({ error: 'Acesso negado — fora do escopo da sua obra' }, { status: 403 })
    }
    const { rowCount } = await pool.query(
      `DELETE FROM obras WHERE id = $1 AND client_id = $2`,
      [Number(id), auth.clientId]
    )
    if (rowCount === 0) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
