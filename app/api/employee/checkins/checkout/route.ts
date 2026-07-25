import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { getCheckinMaxDistanceMeters, haversineDistanceMeters } from '@/lib/geo'

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
    if (lat == null || lng == null) {
      return NextResponse.json({ error: 'Localização atual obrigatória para registrar saída.' }, { status: 422 })
    }

    const openCheckin = await pool.query(
      `SELECT id, obra_id
       FROM employee_checkins
       WHERE person_id = $1 AND checkout_at IS NULL
       ORDER BY checkin_at DESC
       LIMIT 1`,
      [Number(auth.employeeId)]
    )

    if (!openCheckin.rowCount) {
      return NextResponse.json({ error: 'Nenhum check-in aberto encontrado para registrar saída.' }, { status: 404 })
    }

    const openCheckinId = Number(openCheckin.rows[0].id)
    const obraId = openCheckin.rows[0].obra_id != null ? Number(openCheckin.rows[0].obra_id) : null
    if (!obraId) {
      return NextResponse.json({ error: 'Check-in sem obra vinculada. Contate o administrador.' }, { status: 422 })
    }

    const obra = await pool.query(
      `SELECT lat, lng FROM obras WHERE id = $1 LIMIT 1`,
      [obraId]
    )
    if (!obra.rowCount || obra.rows[0].lat == null || obra.rows[0].lng == null) {
      return NextResponse.json({ error: 'A obra vinculada não possui coordenadas GPS configuradas.' }, { status: 422 })
    }

    const obraLat = Number(obra.rows[0].lat)
    const obraLng = Number(obra.rows[0].lng)
    const distanceMeters = Math.round(haversineDistanceMeters(lat, lng, obraLat, obraLng))
    const maxDistanceMeters = getCheckinMaxDistanceMeters()
    if (distanceMeters > maxDistanceMeters) {
      return NextResponse.json(
        {
          error: `Você está fora do raio permitido para esta obra (${distanceMeters}m). Máximo: ${maxDistanceMeters}m.`,
          distanceMeters,
          maxDistanceMeters,
        },
        { status: 403 }
      )
    }

    const updated = await pool.query(
      `UPDATE employee_checkins
       SET checkout_at = NOW(),
           checkout_lat = COALESCE($1, checkout_lat),
           checkout_lng = COALESCE($2, checkout_lng),
           checkout_distance_meters = $3
       WHERE id = $4
       RETURNING id, checkin_at, checkout_at, checkin_lat, checkin_lng, checkin_distance_meters,
                 checkout_lat, checkout_lng, checkout_distance_meters`,
      [lat, lng, distanceMeters, openCheckinId]
    )

    return NextResponse.json(updated.rows[0])
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
