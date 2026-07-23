import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import pool, { initDb } from '@/lib/db'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Para clientes, busca dados completos do perfil no banco
  if (user.role === 'client') {
    await initDb()
    const { rows } = await pool.query(
      `SELECT phone, address, lat, lng FROM users WHERE id = $1`,
      [user.sub]
    )
    const profile = rows[0] ?? {}
    return NextResponse.json({
      id: user.sub,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
      fullName: user.fullName,
      phone: profile.phone ?? null,
      address: profile.address ?? null,
      lat: profile.lat ?? null,
      lng: profile.lng ?? null,
    })
  }

  // Para operadores vinculados a uma obra, resolve o nome para exibição
  if (user.role === 'operator' && user.obraId) {
    await initDb()
    const { rows } = await pool.query(`SELECT name FROM obras WHERE id = $1`, [Number(user.obraId)])
    return NextResponse.json({
      id: user.sub,
      username: user.username,
      role: user.role,
      clientId: user.clientId,
      fullName: user.fullName,
      permissions: user.permissions,
      obraId: user.obraId,
      obraName: rows[0]?.name ?? null,
    })
  }

  return NextResponse.json({
    id: user.sub,
    username: user.username,
    role: user.role,
    clientId: user.clientId,
    fullName: user.fullName,
    permissions: user.permissions,
    obraId: user.obraId,
  })
}
