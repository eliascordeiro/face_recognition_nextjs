#!/usr/bin/env node
/**
 * Cria o usuário admin padrão no banco.
 * Uso: node scripts/seed-admin.mjs
 *
 * Variáveis de ambiente opcionais:
 *   ADMIN_USERNAME  (padrão: admin)
 *   ADMIN_PASSWORD  (padrão: admin123)
 *   DATABASE_URL    (obrigatório se não estiver em .env.local)
 */

import { createRequire } from 'module'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Carrega .env.local manualmente se existir
const envPath = resolve(__dirname, '../.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] = match[2].trim()
  }
}

const require = createRequire(import.meta.url)
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

const username = process.env.ADMIN_USERNAME ?? 'admin'
const password = process.env.ADMIN_PASSWORD ?? 'admin123'

async function main() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        username   VARCHAR(100) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        role       VARCHAR(20)  NOT NULL DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    const hash = await bcrypt.hash(password, 10)
    const { rows } = await client.query(
      `INSERT INTO users (username, password, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'admin'
       RETURNING id, username, role`,
      [username, hash]
    )

    console.log(`✅ Admin criado/atualizado: username="${rows[0].username}" (id=${rows[0].id})`)
    console.log(`   Senha: ${password}`)
    console.log('   ⚠️  Altere a senha após o primeiro login em produção!')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
