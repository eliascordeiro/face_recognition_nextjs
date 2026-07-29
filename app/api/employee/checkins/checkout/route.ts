import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { getCheckinMaxDistanceMeters, haversineDistanceMeters } from '@/lib/geo'
import { isValidEmail, normalizeEmail } from '@/lib/security'
import { getAttendanceFaceThreshold, toFaceConfidencePercent } from '@/lib/faceRecognition'

const FACE_THRESHOLD = getAttendanceFaceThreshold()

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
    const email = normalizeEmail(String(body.email ?? ''))
    const faceEmbedding = parseEmbedding(body.embedding)
    if (lat == null || lng == null) {
      return NextResponse.json({ error: 'Localização atual obrigatória para registrar saída.' }, { status: 422 })
    }
    if (!auth.email) {
      return NextResponse.json({ error: 'Sessão sem e-mail vinculado. Faça login novamente.' }, { status: 401 })
    }
    if (!isValidEmail(email) || email !== normalizeEmail(auth.email)) {
      return NextResponse.json({ error: 'Confirmação de e-mail inválida para esta sessão.' }, { status: 403 })
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

    const vectorStr = `[${faceEmbedding.join(',')}]`
    const faceCheck = await pool.query(
      `SELECT (embedding <-> $1::vector) AS face_distance
       FROM persons
       WHERE id = $2
         AND active = TRUE
         AND allow_face_login = TRUE
         AND LOWER(email) = LOWER($3)
         AND embedding IS NOT NULL
       LIMIT 1`,
      [vectorStr, Number(auth.employeeId), email]
    )
    if (!faceCheck.rowCount) {
      return NextResponse.json({ error: 'Reconhecimento facial não habilitado para este usuário.' }, { status: 403 })
    }
    const faceDistance = Number(faceCheck.rows[0].face_distance)
    const faceConfidencePercent = toFaceConfidencePercent(faceDistance, FACE_THRESHOLD)
    if (!Number.isFinite(faceDistance) || faceDistance >= FACE_THRESHOLD) {
      console.warn(
        `[employee.checkout] facial_reject person=${auth.employeeId} distance=${Number.isFinite(faceDistance) ? faceDistance.toFixed(4) : 'NaN'} threshold=${FACE_THRESHOLD.toFixed(4)} confidence=${faceConfidencePercent}`
      )
      return NextResponse.json(
        {
          error: 'Falha na confirmação facial para registrar saída.',
          faceDistance: Number.isFinite(faceDistance) ? Number(faceDistance.toFixed(4)) : null,
          faceThreshold: Number(FACE_THRESHOLD.toFixed(4)),
          faceConfidencePercent,
        },
        { status: 403 }
      )
    }

    console.info(
      `[employee.checkout] facial_accept person=${auth.employeeId} distance=${faceDistance.toFixed(4)} threshold=${FACE_THRESHOLD.toFixed(4)} confidence=${faceConfidencePercent} geoDistance=${distanceMeters}`
    )

    const updated = await pool.query(
      `UPDATE employee_checkins
       SET checkout_at = NOW(),
           checkout_lat = COALESCE($1, checkout_lat),
           checkout_lng = COALESCE($2, checkout_lng),
           checkout_distance_meters = $3,
           checkout_face_distance = $4
       WHERE id = $5
       RETURNING id, checkin_at, checkout_at, checkin_lat, checkin_lng, checkin_distance_meters,
                 checkout_lat, checkout_lng, checkout_distance_meters, checkout_face_distance`,
      [lat, lng, distanceMeters, Number(faceDistance.toFixed(6)), openCheckinId]
    )

    return NextResponse.json({
      ...updated.rows[0],
      faceThreshold: Number(FACE_THRESHOLD.toFixed(4)),
      faceConfidencePercent,
    })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
