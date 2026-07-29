import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { COOKIE_NAME, COOKIE_OPTIONS, signToken } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/security'
import { getEmployeeFaceLoginThreshold, toFaceConfidencePercent } from '@/lib/faceRecognition'
import { recordFaceRecognitionEvent } from '@/lib/faceRecognitionMetrics'

const MATCH_THRESHOLD = getEmployeeFaceLoginThreshold()

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) {
    throw new Error('embedding deve ser um array de 128 números')
  }
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) {
    throw new Error('embedding contém valores não numéricos')
  }
  return raw as number[]
}

export async function POST(request: NextRequest) {
  try {
    await initDb()
    const body = await request.json()
    const email = normalizeEmail(String(body.email ?? ''))
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Informe um e-mail válido para reconhecimento facial.' }, { status: 422 })
    }
    const emb = parseEmbedding(body.embedding)
    const vectorStr = `[${emb.join(',')}]`

    const found = await pool.query(
      `SELECT id, name, email, client_id, obra_id, active,
              (embedding <-> $1::vector) AS distance
       FROM persons
       WHERE embedding IS NOT NULL
         AND allow_face_login = TRUE
         AND active = TRUE
         AND LOWER(email) = LOWER($2)
       ORDER BY distance ASC
       LIMIT 1`,
      [vectorStr, email]
    )

    if (!found.rowCount) {
      return NextResponse.json({ error: 'Funcionário não encontrado para este e-mail ou login facial não habilitado.' }, { status: 404 })
    }

    const person = found.rows[0]
    const distance = Number(person.distance)
    const confidence = toFaceConfidencePercent(distance, MATCH_THRESHOLD)
    if (!Number.isFinite(distance) || distance >= MATCH_THRESHOLD) {
      await recordFaceRecognitionEvent({
        scenario: 'employee_login',
        accepted: false,
        clientId: person.client_id ? Number(person.client_id) : null,
        personId: Number(person.id),
        obraId: person.obra_id != null ? Number(person.obra_id) : null,
        distance: Number.isFinite(distance) ? distance : null,
        threshold: MATCH_THRESHOLD,
        confidencePercent: confidence,
        reason: Number.isFinite(distance) ? 'face_distance_above_threshold' : 'face_distance_invalid',
      })
      console.warn(
        `[employee.face-login] reject person=${person.id} distance=${Number.isFinite(distance) ? distance.toFixed(4) : 'NaN'} threshold=${MATCH_THRESHOLD.toFixed(4)} confidence=${confidence}`
      )
      return NextResponse.json({
        error: 'Rosto não reconhecido com confiança suficiente',
        confidence,
        faceThreshold: Number(MATCH_THRESHOLD.toFixed(4)),
      }, { status: 401 })
    }

    await recordFaceRecognitionEvent({
      scenario: 'employee_login',
      accepted: true,
      clientId: person.client_id ? Number(person.client_id) : null,
      personId: Number(person.id),
      obraId: person.obra_id != null ? Number(person.obra_id) : null,
      distance,
      threshold: MATCH_THRESHOLD,
      confidencePercent: confidence,
      reason: 'ok',
    })

    console.info(
      `[employee.face-login] accept person=${person.id} distance=${distance.toFixed(4)} threshold=${MATCH_THRESHOLD.toFixed(4)} confidence=${confidence}`
    )

    const token = await signToken({
      sub: String(person.id),
      employeeId: String(person.id),
      username: person.email ?? `employee-${person.id}`,
      email: person.email ?? undefined,
      role: 'employee',
      clientId: person.client_id ? String(person.client_id) : undefined,
      obraId: person.obra_id != null ? String(person.obra_id) : undefined,
      fullName: person.name,
    })

    const response = NextResponse.json({
      id: person.id,
      role: 'employee',
      fullName: person.name,
      email: person.email,
      confidence,
      faceThreshold: Number(MATCH_THRESHOLD.toFixed(4)),
      clientId: person.client_id ? String(person.client_id) : undefined,
      obraId: person.obra_id != null ? String(person.obra_id) : undefined,
    })
    response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS)
    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
