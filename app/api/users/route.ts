import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

// GET /api/users
// admin  → lista todos os clientes (role=client)
// client → lista seus operadores (client_id=auth.sub)
export async function GET() {
  await initDb()
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  if (auth.role === 'admin') {
    const { rows } = await pool.query(
      `SELECT id, username, full_name, role, created_at
       FROM users WHERE role = 'client' ORDER BY id`
    )
    return NextResponse.json(rows)
  }

  if (auth.role === 'client') {
    const { rows } = await pool.query(
      `SELECT id, username, full_name, role, created_at
       FROM users WHERE client_id = $1 ORDER BY id`,
      [auth.sub]
    )
    return NextResponse.json(rows)
  }

  return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
}

// POST /api/users
// admin  → cria cliente (role=client)
// client → cria operador (role=operator, client_id=auth.sub)
export async function POST(request: Request) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    if (auth.role === 'operator') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

    const { username, password, fullName } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Usuário e senha obrigatórios' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter ao menos 6 caracteres' }, { status: 400 })
    }

    const hash = await bcrypt.hash(password, 10)

    if (auth.role === 'admin') {
      // Admin cria cliente
      const { rows } = await pool.query(
        `INSERT INTO users (username, password, role, full_name)
         VALUES ($1, $2, 'client', $3)
         RETURNING id, username, full_name, role, created_at`,
        [username, hash, fullName || null]
      )
      return NextResponse.json(rows[0], { status: 201 })
    }

    // Client cria operador
    const { rows } = await pool.query(
      `INSERT INTO users (username, password, role, full_name, client_id)
       VALUES ($1, $2, 'operator', $3, $4)
       RETURNING id, username, full_name, role, created_at`,
      [username, hash, fullName || null, auth.sub]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Usuário já existe' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
