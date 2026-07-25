import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { getCheckinMaxDistanceMeters, haversineDistanceMeters } from '@/lib/geo'
import { isValidEmail, normalizeEmail } from '@/lib/security'

const FACE_THRESHOLD = Number(process.env.ATTENDANCE_FACE_MAX_DISTANCE ?? 0.55)

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) {
    throw new Error('embedding deve ser um array de 128 números')
  }
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) {
    throw new Error('embedding contém valores não numéricos')
  }
  return raw as number[]
}

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
      `SELECT id, checkin_at, checkout_at, checkin_lat, checkin_lng, checkin_distance_meters,
              checkout_lat, checkout_lng, checkout_distance_meters, notes
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
    const email = normalizeEmail(String(body.email ?? ''))
    const faceEmbedding = parseEmbedding(body.embedding)
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null

    if (!auth.email) {
      return NextResponse.json({ error: 'Sessão sem e-mail vinculado. Faça login novamente.' }, { status: 401 })
    }
    if (!isValidEmail(email) || email !== normalizeEmail(auth.email)) {
      return NextResponse.json({ error: 'Confirmação de e-mail inválida para esta sessão.' }, { status: 403 })
    }

    if (!auth.obraId) {
      return NextResponse.json({ error: 'Funcionário sem obra vinculada. Contate o administrador.' }, { status: 422 })
    }
    if (lat == null || lng == null) {
      return NextResponse.json({ error: 'Localização atual obrigatória para registrar presença.' }, { status: 422 })
    }

    const obra = await pool.query(
      `SELECT id, lat, lng FROM obras WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [Number(auth.obraId), Number(auth.clientId)]
    )
    if (!obra.rowCount) {
      return NextResponse.json({ error: 'Obra vinculada não encontrada.' }, { status: 404 })
    }
    const obraLat = obra.rows[0].lat != null ? Number(obra.rows[0].lat) : null
    const obraLng = obra.rows[0].lng != null ? Number(obra.rows[0].lng) : null
    if (obraLat == null || obraLng == null) {
      return NextResponse.json({ error: 'A obra não possui coordenadas GPS configuradas.' }, { status: 422 })
    }

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

    const vectorStr = `[${faceEmbedding.join(',')}]`
    const faceCheck = await pool.query(
      `SELECT (embedding <-> $1::vector) AS face_distance
       FROM persons
       WHERE id = $2
         AND client_id = $3
         AND active = TRUE
         AND allow_face_login = TRUE
         AND LOWER(email) = LOWER($4)
         AND embedding IS NOT NULL
       LIMIT 1`,
      [vectorStr, Number(auth.employeeId), Number(auth.clientId), email]
    )
    if (!faceCheck.rowCount) {
      return NextResponse.json({ error: 'Reconhecimento facial não habilitado para este usuário.' }, { status: 403 })
    }

    const faceDistance = Number(faceCheck.rows[0].face_distance)
    if (!Number.isFinite(faceDistance) || faceDistance >= FACE_THRESHOLD) {
      return NextResponse.json(
        {
          error: 'Falha na confirmação facial para registrar presença.',
          faceDistance: Number.isFinite(faceDistance) ? Number(faceDistance.toFixed(4)) : null,
        },
        { status: 403 }
      )
    }

    const created = await pool.query(
      `INSERT INTO employee_checkins (person_id, client_id, obra_id, checkin_lat, checkin_lng, checkin_distance_meters, checkin_face_distance, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, checkin_at, checkin_lat, checkin_lng, checkin_distance_meters, checkin_face_distance, notes`,
      [
        Number(auth.employeeId),
        Number(auth.clientId),
        auth.obraId ? Number(auth.obraId) : null,
        lat,
        lng,
        distanceMeters,
        Number(faceDistance.toFixed(6)),
        notes,
      ]
    )

    return NextResponse.json(created.rows[0], { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
