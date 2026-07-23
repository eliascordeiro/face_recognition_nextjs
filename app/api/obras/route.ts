import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { composeAddress, cleanCep, cleanStr, cleanState } from '@/lib/address'
import { hasCapability } from '@/lib/permissions'

const VALID_STATUS = ['planning', 'in_progress', 'paused', 'completed']

// GET /api/obras — lista obras do cliente autenticado (com contagem de funcionários alocados)
// Operadores só veem a lista com a capacidade 'obras.view' (somente leitura —
// criar/editar/remover obra continua exclusivo do cliente). Se o operador
// estiver vinculado a uma obra específica, só enxerga essa obra.
export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    if (!hasCapability(auth, 'obras.view')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const params: (string | number)[] = [auth.clientId]
    let scopeClause = ''
    if (auth.role === 'operator' && auth.obraId) {
      params.push(Number(auth.obraId))
      scopeClause = ` AND o.id = $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.description, o.status, o.start_date,
              o.cep, o.street, o.number, o.neighborhood, o.city, o.state,
              o.address, o.lat, o.lng, o.created_at,
              COUNT(p.id)::int AS employee_count
       FROM obras o
       LEFT JOIN persons p ON p.obra_id = o.id
       WHERE o.client_id = $1${scopeClause}
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      params
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

    const body = await request.json()
    const { name, description, status, startDate, lat, lng } = body

    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome da obra é obrigatório (mín. 2 caracteres)' }, { status: 422 })
    }
    const cleanStatus = VALID_STATUS.includes(status) ? status : 'planning'

    const cep = cleanCep(body.cep)
    const street = cleanStr(body.street, 255)
    const number = cleanStr(body.number, 20)
    const neighborhood = cleanStr(body.neighborhood, 150)
    const city = cleanStr(body.city, 150)
    const state = cleanState(body.state)
    const address = composeAddress({ cep, street, number, neighborhood, city, state })

    const { rows } = await pool.query(
      `INSERT INTO obras (name, description, status, start_date, cep, street, number, neighborhood, city, state, address, lat, lng, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, name, description, status, start_date, cep, street, number, neighborhood, city, state, address, lat, lng, created_at, 0 AS employee_count`,
      [
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        cleanStatus,
        typeof startDate === 'string' && startDate ? startDate : null,
        cep, street, number, neighborhood, city, state, address,
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
