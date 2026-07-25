import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { COOKIE_NAME, COOKIE_OPTIONS, signToken } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/security'

const MATCH_THRESHOLD = 0.6

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
    if (!Number.isFinite(distance) || distance >= MATCH_THRESHOLD) {
      return NextResponse.json({ error: 'Rosto não reconhecido com confiança suficiente' }, { status: 401 })
    }

    const confidence = Math.max(0, Math.round((1 - distance / MATCH_THRESHOLD) * 100))

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
