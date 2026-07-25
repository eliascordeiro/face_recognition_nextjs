import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

function toNumericOrNull(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'employee' || !auth.employeeId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const open = await pool.query(
      `SELECT id, checkin_at, checkin_lat, checkin_lng
       FROM employee_checkins
       WHERE person_id = $1 AND checkout_at IS NULL
       ORDER BY checkin_at DESC
       LIMIT 1`,
      [Number(auth.employeeId)]
    )

    const history = await pool.query(
      `SELECT id, checkin_at, checkout_at, checkin_lat, checkin_lng, checkout_lat, checkout_lng, notes
       FROM employee_checkins
       WHERE person_id = $1
       ORDER BY checkin_at DESC
       LIMIT 15`,
      [Number(auth.employeeId)]
    )

    return NextResponse.json({
      openCheckin: open.rows[0] ?? null,
      history: history.rows,
    })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'employee' || !auth.employeeId || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const hasOpen = await pool.query(
      `SELECT id FROM employee_checkins WHERE person_id = $1 AND checkout_at IS NULL LIMIT 1`,
      [Number(auth.employeeId)]
    )
    if (hasOpen.rowCount) {
      return NextResponse.json({ error: 'Já existe um check-in aberto. Registre a saída antes de nova entrada.' }, { status: 409 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const lat = toNumericOrNull(body.lat)
    const lng = toNumericOrNull(body.lng)
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null

    const created = await pool.query(
      `INSERT INTO employee_checkins (person_id, client_id, obra_id, checkin_lat, checkin_lng, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, checkin_at, checkin_lat, checkin_lng, notes`,
      [
        Number(auth.employeeId),
        Number(auth.clientId),
        auth.obraId ? Number(auth.obraId) : null,
        lat,
        lng,
        notes,
      ]
    )

    return NextResponse.json(created.rows[0], { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
