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
    if (!auth || auth.role !== 'client' || !auth.clientId) {
      return NextResponse.json({ error: 'Apenas o gestor pode registrar exceção manual.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const personId = Number(body.personId)
    const action = String(body.action ?? '')
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    const lat = toNumericOrNull(body.lat)
    const lng = toNumericOrNull(body.lng)

    if (!Number.isFinite(personId) || personId <= 0) {
      return NextResponse.json({ error: 'Funcionário inválido.' }, { status: 422 })
    }
    if (action !== 'checkin' && action !== 'checkout') {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 422 })
    }
    if (!reason || reason.length < 8) {
      return NextResponse.json({ error: 'Informe uma justificativa com pelo menos 8 caracteres.' }, { status: 422 })
    }

    const person = await pool.query(
      `SELECT id, client_id, obra_id, active
       FROM persons
       WHERE id = $1 AND client_id = $2
       LIMIT 1`,
      [personId, Number(auth.clientId)]
    )
    if (!person.rowCount) {
      return NextResponse.json({ error: 'Funcionário não encontrado para este cliente.' }, { status: 404 })
    }
    if (!person.rows[0].active) {
      return NextResponse.json({ error: 'Funcionário está inativo.' }, { status: 409 })
    }

    if (action === 'checkin') {
      const hasOpen = await pool.query(
        `SELECT id FROM employee_checkins WHERE person_id = $1 AND checkout_at IS NULL LIMIT 1`,
        [personId]
      )
      if (hasOpen.rowCount) {
        return NextResponse.json({ error: 'Funcionário já possui entrada em aberto.' }, { status: 409 })
      }

      const created = await pool.query(
        `INSERT INTO employee_checkins (
          person_id, client_id, obra_id, checkin_lat, checkin_lng,
          checkin_method, checkin_override_reason, checkin_override_by_user_id
        )
         VALUES ($1, $2, $3, $4, $5, 'override', $6, $7)
         RETURNING id, checkin_at, checkout_at, checkin_method, checkin_override_reason`,
        [
          personId,
          Number(auth.clientId),
          person.rows[0].obra_id != null ? Number(person.rows[0].obra_id) : null,
          lat,
          lng,
          reason,
          Number(auth.sub),
        ]
      )

      return NextResponse.json({
        ok: true,
        action,
        attendance: created.rows[0],
      })
    }

    const updated = await pool.query(
      `UPDATE employee_checkins
       SET checkout_at = NOW(),
           checkout_lat = COALESCE($1, checkout_lat),
           checkout_lng = COALESCE($2, checkout_lng),
           checkout_method = 'override',
           checkout_override_reason = $3,
           checkout_override_by_user_id = $4
       WHERE id = (
         SELECT id
         FROM employee_checkins
         WHERE person_id = $5 AND checkout_at IS NULL
         ORDER BY checkin_at DESC
         LIMIT 1
       )
       RETURNING id, checkin_at, checkout_at, checkout_method, checkout_override_reason`,
      [lat, lng, reason, Number(auth.sub), personId]
    )

    if (!updated.rowCount) {
      return NextResponse.json({ error: 'Funcionário não possui entrada aberta para encerrar.' }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      action,
      attendance: updated.rows[0],
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
