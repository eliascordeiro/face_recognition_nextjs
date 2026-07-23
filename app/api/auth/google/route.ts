import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { signToken, COOKIE_NAME, COOKIE_OPTIONS } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/security'

type GoogleTokenInfo = {
  aud?: string
  sub?: string
  email?: string
  email_verified?: string
  name?: string
}

async function verifyGoogleToken(idToken: string): Promise<GoogleTokenInfo | null> {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  const res = await fetch(url)
  if (!res.ok) return null
  return (await res.json()) as GoogleTokenInfo
}

export async function POST(request: Request) {
  try {
    await initDb()

    const { credential } = await request.json()
    if (!credential || typeof credential !== 'string') {
      return NextResponse.json({ error: 'Credencial Google inválida' }, { status: 400 })
    }

    const info = await verifyGoogleToken(credential)
    const expectedAud = process.env.GOOGLE_CLIENT_ID

    if (!info || !expectedAud || info.aud !== expectedAud) {
      return NextResponse.json({ error: 'Token Google inválido' }, { status: 401 })
    }

    const email = normalizeEmail(info.email ?? '')
    const googleSub = info.sub ?? ''
    const emailVerified = info.email_verified === 'true'

    if (!googleSub || !isValidEmail(email) || !emailVerified) {
      return NextResponse.json({ error: 'Conta Google sem e-mail verificado' }, { status: 401 })
    }

    const existing = await pool.query(
      `SELECT id, username, email, role, full_name, client_id, permissions, obra_id, google_sub
       FROM users
       WHERE google_sub = $1 OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [googleSub, email]
    )

    let user = existing.rows[0]
    if (!user) {
      const randomPasswordHash = await bcrypt.hash(`google-${googleSub}-${Date.now()}`, 10)
      const created = await pool.query(
        `INSERT INTO users (username, email, password, role, full_name, auth_provider, google_sub)
         VALUES ($1, $2, $3, 'client', $4, 'google', $5)
         RETURNING id, username, email, role, full_name, client_id, permissions, obra_id, google_sub`,
        [email, email, randomPasswordHash, info.name ?? null, googleSub]
      )
      user = created.rows[0]
    } else if (!user.google_sub) {
      const linked = await pool.query(
        `UPDATE users SET google_sub = $1, auth_provider = 'google' WHERE id = $2
         RETURNING id, username, email, role, full_name, client_id, permissions, obra_id, google_sub`,
        [googleSub, user.id]
      )
      user = linked.rows[0]
    }

    const clientId =
      user.role === 'client'
        ? String(user.id)
        : user.role === 'operator'
        ? String(user.client_id)
        : undefined

    const token = await signToken({
      sub: String(user.id),
      username: user.username,
      email: user.email ?? undefined,
      role: user.role,
      clientId,
      fullName: user.full_name ?? undefined,
      permissions: user.role === 'operator' ? (user.permissions ?? []) : undefined,
      obraId: user.role === 'operator' && user.obra_id != null ? String(user.obra_id) : undefined,
    })

    const response = NextResponse.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      clientId,
      permissions: user.role === 'operator' ? (user.permissions ?? []) : undefined,
      obraId: user.role === 'operator' && user.obra_id != null ? String(user.obra_id) : undefined,
    })
    response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS)
    return response
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
