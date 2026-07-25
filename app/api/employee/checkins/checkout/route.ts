import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

function toNumericOrNull(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'employee' || !auth.employeeId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const lat = toNumericOrNull(body.lat)
    const lng = toNumericOrNull(body.lng)

    const updated = await pool.query(
      `UPDATE employee_checkins
       SET checkout_at = NOW(),
           checkout_lat = COALESCE($1, checkout_lat),
           checkout_lng = COALESCE($2, checkout_lng)
       WHERE id = (
         SELECT id
         FROM employee_checkins
         WHERE person_id = $3 AND checkout_at IS NULL
         ORDER BY checkin_at DESC
         LIMIT 1
       )
       RETURNING id, checkin_at, checkout_at, checkin_lat, checkin_lng, checkout_lat, checkout_lng`,
      [lat, lng, Number(auth.employeeId)]
    )

    if (!updated.rowCount) {
      return NextResponse.json({ error: 'Nenhum check-in aberto encontrado para registrar saída.' }, { status: 404 })
    }

    return NextResponse.json(updated.rows[0])
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
