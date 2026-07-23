import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { sha256 } from '@/lib/security'

export async function POST(request: Request) {
  try {
    await initDb()
    const { token, password } = await request.json()

    const tokenStr = typeof token === 'string' ? token.trim() : ''
    const newPassword = typeof password === 'string' ? password : ''

    if (!tokenStr) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 422 })
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter no mínimo 6 caracteres' }, { status: 422 })
    }

    const tokenHash = sha256(tokenStr)

    const found = await pool.query(
      `SELECT id FROM users
       WHERE reset_password_token_hash = $1
         AND reset_password_expires_at IS NOT NULL
         AND reset_password_expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    )

    if (!found.rowCount) {
      return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 400 })
    }

    const hash = await bcrypt.hash(newPassword, 10)

    await pool.query(
      `UPDATE users
       SET password = $1,
           reset_password_token_hash = NULL,
           reset_password_expires_at = NULL
       WHERE id = $2`,
      [hash, found.rows[0].id]
    )

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
