import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { signToken, COOKIE_NAME, COOKIE_OPTIONS } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/security'

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
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    )
    if (exists.rowCount) {
      return NextResponse.json({ error: 'Já existe uma conta com este e-mail' }, { status: 409 })
    }

    const hash = await bcrypt.hash(password, 10)
    const username = email

    const created = await pool.query(
      `INSERT INTO users (username, email, password, role, full_name, auth_provider)
       VALUES ($1, $2, $3, 'client', $4, 'local')
       RETURNING id, username, email, role, full_name`,
      [username, email, hash, companyName || fullName]
    )

    const user = created.rows[0]
    const token = await signToken({
      sub: String(user.id),
      username: user.username,
      email: user.email,
      role: user.role,
      clientId: String(user.id),
      fullName: user.full_name ?? undefined,
    })

    const response = NextResponse.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      clientId: String(user.id),
      fullName: user.full_name,
    }, { status: 201 })

    response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS)
    return response
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Já existe uma conta com este e-mail' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
