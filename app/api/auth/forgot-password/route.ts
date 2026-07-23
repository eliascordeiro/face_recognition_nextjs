import { NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { createResetToken, isValidEmail, normalizeEmail, sha256 } from '@/lib/security'
import { sendMail } from '@/lib/email'

const SUCCESS_MESSAGE = 'Se o e-mail existir, enviaremos instruções de redefinição.'

export async function POST(request: Request) {
  try {
    await initDb()
    const { email } = await request.json()
    const normalized = normalizeEmail(String(email ?? ''))

    if (!isValidEmail(normalized)) {
      return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE })
    }

    const result = await pool.query(
      `SELECT id, full_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalized]
    )

    if (!result.rowCount) {
      return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE })
    }

    const token = createResetToken()
    const tokenHash = sha256(token)

    await pool.query(
      `UPDATE users
       SET reset_password_token_hash = $1,
           reset_password_expires_at = NOW() + INTERVAL '1 hour'
       WHERE id = $2`,
      [tokenHash, result.rows[0].id]
    )

    const baseUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const link = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`

    const recipientName = result.rows[0].full_name ?? 'usuário'

    try {
      await sendMail({
        to: normalized,
        subject: 'Redefinição de senha - Obras',
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.4">
            <h2>Redefinição de senha</h2>
            <p>Olá, ${recipientName}.</p>
            <p>Recebemos uma solicitação para redefinir sua senha.</p>
            <p><a href="${link}" target="_blank" rel="noopener noreferrer">Clique aqui para redefinir sua senha</a></p>
            <p>Este link expira em 1 hora.</p>
            <p>Se você não solicitou essa alteração, pode ignorar este e-mail.</p>
          </div>
        `,
      })
    } catch (mailErr) {
      console.error('Falha ao enviar e-mail de redefinição:', mailErr)
    }

    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE })
  } catch {
    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE })
  }
}
