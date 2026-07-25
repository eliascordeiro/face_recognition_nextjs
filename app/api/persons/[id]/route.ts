import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { hasCapability } from '@/lib/permissions'
import bcrypt from 'bcryptjs'

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) throw new Error('embedding deve ser um array de 128 números')
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) throw new Error('embedding contém valores não numéricos')
  return raw as number[]
}

// ── PATCH /api/persons/[id] ───────────────────────────────────────────────────
// Atualiza dados cadastrais e/ou vincula o reconhecimento facial (embedding)
// depois do cadastro inicial — usado pelo modal "Reconhecimento facial".
// Dados cadastrais exigem 'employees.manage'; embedding/thumbnail exigem
// 'employees.face' (podem ser liberadas independentemente para o operador).
// Operador vinculado a uma obra só pode editar funcionários dessa obra.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr, 10)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json()

    if ('accessPassword' in body) {
      const emailCandidate = typeof body.email === 'string' ? body.email.trim() : undefined
      if (emailCandidate === '') {
        return NextResponse.json({ error: 'Informe um e-mail para habilitar acesso com senha.' }, { status: 422 })
      }
      if (emailCandidate === undefined) {
        const existing = await pool.query(
          `SELECT email FROM persons WHERE id = $1 AND client_id = $2 LIMIT 1`,
          [id, auth.clientId]
        )
        if (!existing.rowCount || !existing.rows[0].email) {
          return NextResponse.json({ error: 'Informe um e-mail para habilitar acesso com senha.' }, { status: 422 })
        }
      }
    }

    const touchesProfile = ['name', 'phone', 'email', 'document', 'role', 'active', 'obraId', 'accessPassword'].some((k) => k in body)
    if (touchesProfile && !hasCapability(auth, 'employees.manage')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }
    if (body.embedding != null && !hasCapability(auth, 'employees.face')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }
    // Operador com escopo de obra não pode realocar funcionários para fora dela
    if (auth.role === 'operator' && auth.obraId && 'obraId' in body) {
      return NextResponse.json({ error: 'Acesso negado — fora do escopo da sua obra' }, { status: 403 })
    }

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (typeof body.name === 'string') {
      if (body.name.trim().length < 2 || body.name.trim().length > 255) {
        return NextResponse.json({ error: 'Nome inválido (2–255 caracteres)' }, { status: 422 })
      }
      fields.push(`name = $${i++}`); values.push(body.name.trim())
    }
    if (typeof body.phone === 'string' || body.phone === null) {
      fields.push(`phone = $${i++}`); values.push(typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').slice(0, 11) || null : null)
    }
    if (typeof body.email === 'string' || body.email === null) {
      fields.push(`email = $${i++}`); values.push(typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 255) : null)
    }
    if (typeof body.document === 'string' || body.document === null) {
      fields.push(`document = $${i++}`); values.push(typeof body.document === 'string' ? body.document.replace(/\D/g, '').slice(0, 14) || null : null)
    }
    if (typeof body.role === 'string' || body.role === null) {
      fields.push(`role = $${i++}`); values.push(typeof body.role === 'string' && body.role.trim() ? body.role.trim().slice(0, 100) : null)
    }
    if (typeof body.active === 'boolean') {
      fields.push(`active = $${i++}`); values.push(body.active)
    }
    if ('accessPassword' in body) {
      if (typeof body.accessPassword !== 'string' || body.accessPassword.length < 6) {
        return NextResponse.json({ error: 'Senha de acesso deve ter no mínimo 6 caracteres' }, { status: 422 })
      }
      const hash = await bcrypt.hash(body.accessPassword, 10)
      fields.push(`access_password_hash = $${i++}`); values.push(hash)
      fields.push(`allow_face_login = (embedding IS NOT NULL)`)
    }
    if ('obraId' in body) {
      const obraId = body.obraId
      if (obraId !== null && (typeof obraId !== 'number' || !Number.isFinite(obraId))) {
        return NextResponse.json({ error: 'obraId inválido' }, { status: 422 })
      }
      fields.push(`obra_id = $${i++}`); values.push(obraId)
    }
    if (body.embedding != null) {
      const emb = parseEmbedding(body.embedding)
      fields.push(`embedding = $${i++}::vector`); values.push(`[${emb.join(',')}]`)
      fields.push(`allow_face_login = (access_password_hash IS NOT NULL)`)
      if (typeof body.thumbnail === 'string') {
        fields.push(`thumbnail = $${i++}`); values.push(body.thumbnail)
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 422 })
    }

    values.push(id, auth.clientId)
    let scopeClause = ''
    if (auth.role === 'operator' && auth.obraId) {
      values.push(Number(auth.obraId))
      scopeClause = ` AND obra_id = $${values.length}`
    }
    const { rows } = await pool.query(
      `UPDATE persons SET ${fields.join(', ')}
       WHERE id = $${i++} AND client_id = $${i++}${scopeClause}
       RETURNING id, name, phone, email, document, role, active, thumbnail, created_at, obra_id,
                 (embedding IS NOT NULL) AS has_face,
                 (access_password_hash IS NOT NULL) AS has_password_access,
                 allow_face_login`,
      values
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })
    }
    return NextResponse.json(rows[0])
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE /api/persons/[id] ──────────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    if (!hasCapability(auth, 'employees.manage')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr, 10)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Only delete persons belonging to this client (e, se operador com
    // escopo de obra, apenas dentro da obra dele)
    const values: (number | string)[] = [id, auth.clientId]
    let scopeClause = ''
    if (auth.role === 'operator' && auth.obraId) {
      values.push(Number(auth.obraId))
      scopeClause = ' AND obra_id = $3'
    }
    const result = await pool.query(
      `DELETE FROM persons WHERE id = $1 AND client_id = $2${scopeClause} RETURNING id`,
      values
    )
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
