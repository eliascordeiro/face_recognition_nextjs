import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { signToken, COOKIE_NAME, COOKIE_OPTIONS } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    await initDb()
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Usuário e senha obrigatórios' }, { status: 400 })
    }

    const { rows } = await pool.query(
      'SELECT id, username, password, role, full_name, client_id FROM users WHERE username = $1',
      [username]
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
    }

    const user = rows[0]
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
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
      role: user.role,
      clientId,
      fullName: user.full_name ?? undefined,
    })

    const response = NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      clientId,
    })
    response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS)
    return response
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
