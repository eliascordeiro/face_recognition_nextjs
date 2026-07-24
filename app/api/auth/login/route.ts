import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { signToken, COOKIE_NAME, COOKIE_OPTIONS } from '@/lib/auth'
import { normalizeEmail } from '@/lib/security'

export async function POST(request: Request) {
  try {
    await initDb()
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios' }, { status: 400 })
    }

    const identifier = normalizeEmail(String(email))

    const { rows } = await pool.query(
      `SELECT id, username, email, password, role, full_name, client_id, permissions, obra_id, email_verified_at
       FROM users
       WHERE LOWER(email) = LOWER($1) OR username = $1
       LIMIT 1`,
      [identifier]
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
    }

    const user = rows[0]
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
    }

    if (user.role === 'client' && user.email && !user.email_verified_at) {
      return NextResponse.json(
        {
          error: 'Confirme o código enviado para seu e-mail antes de entrar.',
          code: 'email_not_verified',
          email: user.email,
        },
        { status: 403 }
      )
    }

    // clientId: for clients = own id; for operators = their parent client id
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
