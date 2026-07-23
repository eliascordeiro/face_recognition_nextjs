import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { sanitizePermissions } from '@/lib/permissions'
import { isValidEmail, normalizeEmail } from '@/lib/security'

// GET /api/users
// admin  → lista todos os clientes (role=client)
// client → lista seus operadores (client_id=auth.sub)
export async function GET() {
  await initDb()
  const auth = await getAuthUser()
  if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  if (auth.role === 'admin') {
    const { rows } = await pool.query(
      `SELECT id, username, email, full_name, role, created_at
       FROM users WHERE role = 'client' ORDER BY id`
    )
    return NextResponse.json(rows)
  }

  if (auth.role === 'client') {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.created_at, u.permissions, u.obra_id,
              o.name AS obra_name
       FROM users u
       LEFT JOIN obras o ON o.id = u.obra_id
       WHERE u.client_id = $1 ORDER BY u.id`,
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

    const { email, password, fullName, permissions, obraId } = await request.json()

    const normalizedEmail = normalizeEmail(String(email ?? ''))
    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: 'E-mail e senha obrigatórios' }, { status: 400 })
    }
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter ao menos 6 caracteres' }, { status: 400 })
    }

    const hash = await bcrypt.hash(password, 10)

    if (auth.role === 'admin') {
      // Admin cria cliente
      const { rows } = await pool.query(
        `INSERT INTO users (username, email, password, role, full_name, auth_provider)
         VALUES ($1, $2, $3, 'client', $4, 'local')
         RETURNING id, username, email, full_name, role, created_at`,
        [normalizedEmail, normalizedEmail, hash, fullName || null]
      )
      return NextResponse.json(rows[0], { status: 201 })
    }

    // Client cria operador — com permissões granulares e escopo opcional de obra
    const cleanPermissions = sanitizePermissions(permissions)
    const cleanObraId = typeof obraId === 'number' && Number.isFinite(obraId) ? obraId : null

    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password, role, full_name, client_id, permissions, obra_id, auth_provider)
       VALUES ($1, $2, $3, 'operator', $4, $5, $6, $7, 'local')
       RETURNING id, username, email, full_name, role, created_at, permissions, obra_id`,
      [normalizedEmail, normalizedEmail, hash, fullName || null, auth.sub, cleanPermissions, cleanObraId]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
