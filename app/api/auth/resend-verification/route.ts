import { NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { isValidEmail, normalizeEmail } from '@/lib/security'
import {
  createEmailVerificationCode,
  createEmailVerificationCodeHash,
  EMAIL_VERIFICATION_EXPIRES_MINUTES,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  sendEmailVerificationCode,
} from '@/lib/emailVerification'

export async function POST(request: Request) {
  try {
    await initDb()
    const { email } = await request.json()

    const normalizedEmail = normalizeEmail(String(email ?? ''))
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'E-mail inválido' }, { status: 422 })
    }

    const found = await pool.query(
      `SELECT id, full_name, email_verified_at, email_verification_last_sent_at
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

    if (user.email_verification_last_sent_at) {
      const lastSent = new Date(user.email_verification_last_sent_at).getTime()
      const now = Date.now()
      const elapsedSeconds = Math.floor((now - lastSent) / 1000)
      if (elapsedSeconds < EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS) {
        return NextResponse.json(
          { error: 'Aguarde antes de solicitar um novo código.', retryAfter: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS - elapsedSeconds },
          { status: 429 }
        )
      }
    }

    const code = createEmailVerificationCode()
    const codeHash = createEmailVerificationCodeHash(code)

    await pool.query(
      `UPDATE users
       SET email_verification_code_hash = $1,
           email_verification_expires_at = NOW() + ($2::text || ' minutes')::interval,
           email_verification_attempts = 0,
           email_verification_last_sent_at = NOW()
       WHERE id = $3`,
      [codeHash, String(EMAIL_VERIFICATION_EXPIRES_MINUTES), user.id]
    )

    await sendEmailVerificationCode({
      to: normalizedEmail,
      recipientName: user.full_name,
      code,
    })

    return NextResponse.json({ ok: true, message: 'Novo código enviado para o seu e-mail.' })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
