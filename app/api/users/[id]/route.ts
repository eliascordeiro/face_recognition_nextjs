import { NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

// DELETE /api/users/[id]
// admin  → remove cliente
// client → remove seu operador
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { id: idStr } = await params
    const id = Number(idStr)

    if (String(id) === auth.sub) {
      return NextResponse.json({ error: 'Não é possível remover o próprio usuário' }, { status: 400 })
    }

    if (auth.role === 'admin') {
      // Só pode deletar clientes
      const { rowCount } = await pool.query(
        `DELETE FROM users WHERE id = $1 AND role = 'client'`, [id]
      )
      if (rowCount === 0) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    } else if (auth.role === 'client') {
      // Só pode deletar seus próprios operadores
      const { rowCount } = await pool.query(
        `DELETE FROM users WHERE id = $1 AND client_id = $2 AND role = 'operator'`,
        [id, auth.sub]
      )
      if (rowCount === 0) return NextResponse.json({ error: 'Operador não encontrado' }, { status: 404 })
    } else {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PATCH /api/users/[id] — altera senha OU perfil (fullName, phone, address, lat, lng)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { id: idStr } = await params
    const id = Number(idStr)
    const body = await request.json()

    // ── Atualização de perfil (cliente editando o próprio perfil) ──────────
    if ('fullName' in body || 'phone' in body || 'address' in body || 'lat' in body) {
      // Somente o próprio cliente pode editar seu perfil
      if (auth.role !== 'client' || String(id) !== auth.sub) {
        return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
      }
      const cleanPhone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').slice(0, 11) || null : null
      const { rows } = await pool.query(
        `UPDATE users
         SET full_name = COALESCE($1, full_name),
             phone     = COALESCE($2, phone),
             address   = COALESCE($3, address),
             lat       = COALESCE($4, lat),
             lng       = COALESCE($5, lng)
         WHERE id = $6
         RETURNING id, username, full_name, phone, address, lat, lng`,
        [
          typeof body.fullName === 'string' ? body.fullName.trim() || null : null,
          cleanPhone,
          typeof body.address === 'string' ? body.address.trim() || null : null,
          typeof body.lat === 'number' && isFinite(body.lat) ? body.lat : null,
          typeof body.lng === 'number' && isFinite(body.lng) ? body.lng : null,
          id,
        ]
      )
      return NextResponse.json(rows[0])
    }

    // ── Atualização de senha ───────────────────────────────────────────────
    const { password } = body
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter ao menos 6 caracteres' }, { status: 400 })
    }

    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash(password, 10)

    let result
    if (auth.role === 'admin') {
      result = await pool.query(`UPDATE users SET password = $1 WHERE id = $2 AND role = 'client'`, [hash, id])
    } else if (auth.role === 'client') {
      result = await pool.query(`UPDATE users SET password = $1 WHERE id = $2 AND client_id = $3`, [hash, id, auth.sub])
    } else {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    if (result.rowCount === 0) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
