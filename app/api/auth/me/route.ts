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

  return NextResponse.json({
    id: user.sub,
    username: user.username,
    role: user.role,
    clientId: user.clientId,
    fullName: user.fullName,
  })
}
