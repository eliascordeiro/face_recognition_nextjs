import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool, { initDb } from '@/lib/db'
import { COOKIE_NAME, COOKIE_OPTIONS, signToken } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/security'

export async function POST(request: Request) {
  try {
    await initDb()
    const { email, password } = await request.json()

    const normalizedEmail = normalizeEmail(String(email ?? ''))
    const pwd = String(password ?? '')

    if (!isValidEmail(normalizedEmail) || !pwd) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios' }, { status: 400 })
    }

    const found = await pool.query(
      `SELECT p.id, p.name, p.email, p.active, p.client_id, p.obra_id, p.access_password_hash
       FROM persons p
       WHERE LOWER(p.email) = LOWER($1)
       LIMIT 1`,
      [normalizedEmail]
    )

    if (!found.rowCount) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
    }

    const person = found.rows[0]
    if (!person.active) {
      return NextResponse.json({ error: 'Acesso desativado para este funcionário' }, { status: 403 })
    }
    if (!person.access_password_hash) {
      return NextResponse.json({ error: 'Acesso por senha ainda não configurado. Fale com o administrador.' }, { status: 403 })
    }

    const valid = await bcrypt.compare(pwd, person.access_password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
    }

    const token = await signToken({
      sub: String(person.id),
      employeeId: String(person.id),
      username: person.email,
      email: person.email,
      role: 'employee',
      clientId: person.client_id ? String(person.client_id) : undefined,
      obraId: person.obra_id != null ? String(person.obra_id) : undefined,
      fullName: person.name,
    })

    const response = NextResponse.json({
      id: person.id,
      role: 'employee',
      fullName: person.name,
      email: person.email,
      clientId: person.client_id ? String(person.client_id) : undefined,
      obraId: person.obra_id != null ? String(person.obra_id) : undefined,
    })
    response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS)
    return response
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
