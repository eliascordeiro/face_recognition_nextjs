import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { isValidEmail, normalizeEmail } from '@/lib/security'
import {
  createEmailVerificationCode,
  createEmailVerificationCodeHash,
  EMAIL_VERIFICATION_EXPIRES_MINUTES,
  sendEmailVerificationCode,
} from '@/lib/emailVerification'

export async function POST(request: Request) {
  try {
    await initDb()
    const body = await request.json()

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
    const email = normalizeEmail(String(body.email ?? ''))
    const password = String(body.password ?? '')

    if (!fullName || fullName.length < 2) {
      return NextResponse.json({ error: 'Nome completo é obrigatório' }, { status: 422 })
    }
    if (!companyName || companyName.length < 2) {
      return NextResponse.json({ error: 'Nome da empresa é obrigatório' }, { status: 422 })
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'E-mail inválido' }, { status: 422 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter no mínimo 6 caracteres' }, { status: 422 })
    }

    const exists = await pool.query(
      `SELECT id, role, full_name, email_verified_at
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    )

    const hash = await bcrypt.hash(password, 10)
    const username = email
    const displayName = companyName || fullName

    let userId: number
    let recipientName: string | null = displayName

    if (exists.rowCount) {
      const existing = exists.rows[0]
      if (existing.email_verified_at) {
        return NextResponse.json({ error: 'Já existe uma conta com este e-mail' }, { status: 409 })
      }
      if (existing.role !== 'client') {
        return NextResponse.json({ error: 'Este e-mail já está vinculado a outro tipo de conta' }, { status: 409 })
      }

      const updated = await pool.query(
        `UPDATE users
         SET username = $1,
             password = $2,
             role = 'client',
             full_name = $3,
             auth_provider = 'local',
             google_sub = NULL,
             email_verified_at = NULL
         WHERE id = $4
         RETURNING id, full_name`,
        [username, hash, displayName, existing.id]
      )
      userId = updated.rows[0].id
      recipientName = updated.rows[0].full_name ?? displayName
    } else {
      const created = await pool.query(
        `INSERT INTO users (username, email, password, role, full_name, auth_provider, email_verified_at)
         VALUES ($1, $2, $3, 'client', $4, 'local', NULL)
         RETURNING id, full_name`,
        [username, email, hash, displayName]
      )

      userId = created.rows[0].id
      recipientName = created.rows[0].full_name ?? displayName
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
      [codeHash, String(EMAIL_VERIFICATION_EXPIRES_MINUTES), userId]
    )

    await sendEmailVerificationCode({
      to: email,
      recipientName,
      code,
    })

    return NextResponse.json({
      ok: true,
      requiresVerification: true,
      email,
      message: 'Enviamos um código de verificação para o seu e-mail.',
    }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Já existe uma conta com este e-mail' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
