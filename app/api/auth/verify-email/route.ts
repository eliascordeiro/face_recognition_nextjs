import { NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { signToken, COOKIE_NAME, COOKIE_OPTIONS } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/security'
import {
  createEmailVerificationCodeHash,
  EMAIL_VERIFICATION_CODE_LENGTH,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
} from '@/lib/emailVerification'

export async function POST(request: Request) {
  try {
    await initDb()
    const { email, code } = await request.json()

    const normalizedEmail = normalizeEmail(String(email ?? ''))
    const codeValue = String(code ?? '').trim()

    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'E-mail inválido' }, { status: 422 })
    }
    if (!new RegExp(`^\\d{${EMAIL_VERIFICATION_CODE_LENGTH}}$`).test(codeValue)) {
      return NextResponse.json({ error: `Informe o código de ${EMAIL_VERIFICATION_CODE_LENGTH} dígitos` }, { status: 422 })
    }

    const found = await pool.query(
      `SELECT id, username, email, role, full_name, client_id, permissions, obra_id,
              email_verified_at, email_verification_code_hash, email_verification_expires_at,
              email_verification_attempts
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [normalizedEmail]
    )

    if (!found.rowCount) {
      return NextResponse.json({ error: 'Conta não encontrada para este e-mail' }, { status: 404 })
    }

    const user = found.rows[0]

    if (user.email_verified_at) {
      return NextResponse.json({ error: 'Este e-mail já foi verificado. Faça login normalmente.' }, { status: 409 })
    }

    if (!user.email_verification_code_hash || !user.email_verification_expires_at) {
      return NextResponse.json({ error: 'Solicite um novo código de verificação' }, { status: 400 })
    }

    const expiresAt = new Date(user.email_verification_expires_at)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Código expirado. Solicite um novo código.' }, { status: 400 })
    }

    if ((user.email_verification_attempts ?? 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      return NextResponse.json({ error: 'Muitas tentativas inválidas. Solicite um novo código.' }, { status: 429 })
    }

    const codeHash = createEmailVerificationCodeHash(codeValue)
    if (codeHash !== user.email_verification_code_hash) {
      await pool.query(
        `UPDATE users
         SET email_verification_attempts = COALESCE(email_verification_attempts, 0) + 1
         WHERE id = $1`,
        [user.id]
      )
      return NextResponse.json({ error: 'Código inválido' }, { status: 400 })
    }

    await pool.query(
      `UPDATE users
       SET email_verified_at = NOW(),
           email_verification_code_hash = NULL,
           email_verification_expires_at = NULL,
           email_verification_attempts = 0,
           email_verification_last_sent_at = NULL
       WHERE id = $1`,
      [user.id]
    )

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
