import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import pool, { initDb } from '@/lib/db'

export async function GET() {
  const auth = await getAuthUser()
  if (!auth || auth.role !== 'employee') {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  await initDb()
  const result = await pool.query(
    `SELECT p.id, p.name, p.email, p.phone, p.role, p.obra_id, o.name AS obra_name
     FROM persons p
     LEFT JOIN obras o ON o.id = p.obra_id
     WHERE p.id = $1
     LIMIT 1`,
    [Number(auth.employeeId ?? auth.sub)]
  )

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })
  }

  const person = result.rows[0]
  return NextResponse.json({
    id: person.id,
    fullName: person.name,
    email: person.email,
    phone: person.phone,
    roleName: person.role,
    obraId: person.obra_id != null ? String(person.obra_id) : null,
    obraName: person.obra_name ?? null,
    clientId: auth.clientId ?? null,
  })
}
