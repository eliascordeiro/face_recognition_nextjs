import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

let initialized = false

export async function initDb(): Promise<void> {
  if (initialized) return
  initialized = true
  const client = await pool.connect()
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')

    // ── Tabela de usuários ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        username   VARCHAR(100) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        role       VARCHAR(20)  NOT NULL DEFAULT 'operator',
        full_name  VARCHAR(255),
        client_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    // Migrations idempotentes para instalações existentes
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id) ON DELETE CASCADE`)

    // Cria admin padrão se nenhum admin existir
    const { rows: admins } = await client.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)
    if (admins.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD ?? 'admin123', 10)
      await client.query(
        `INSERT INTO users (username, password, role, full_name)
         VALUES ($1, $2, 'admin', 'Administrador')
         ON CONFLICT (username) DO NOTHING`,
        [process.env.ADMIN_USERNAME ?? 'admin', hash]
      )
    }

    // ── Tabela de funcionários ────────────────────────────────────────────
    // embedding é opcional: o funcionário pode ser cadastrado primeiro (dados
    // pessoais) e ter o reconhecimento facial vinculado depois, via botão/modal.
    await client.query(`
      CREATE TABLE IF NOT EXISTS persons (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        embedding  vector(128),
        thumbnail  TEXT,
        client_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id) ON DELETE CASCADE`)
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`)
    await client.query(`ALTER TABLE persons ALTER COLUMN embedding DROP NOT NULL`)
    // Campos adicionais — preparam o cadastro para futuras funcionalidades
    // (ex.: liberar acesso do funcionário ao sistema/app).
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS email VARCHAR(255)`)
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS document VARCHAR(20)`)
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS role VARCHAR(100)`)
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`)

    // Campos de perfil no usuário (cliente: endereço, telefone, GPS)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lat DECIMAL(10,8)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lng DECIMAL(11,8)`)

    // ── Tabela de obras ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS obras (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        address    TEXT,
        lat        DECIMAL(10,8),
        lng        DECIMAL(11,8),
        client_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    // Detalhes adicionais da obra: descrição, status do andamento e data de início
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS description TEXT`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'planning'`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS start_date DATE`)
    // Endereço estruturado (CEP, rua, número, bairro, cidade, UF).
    // `address` é mantido como texto derivado (exibição/link do mapa).
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS cep VARCHAR(9)`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS street VARCHAR(255)`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS number VARCHAR(20)`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(150)`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS city VARCHAR(150)`)
    await client.query(`ALTER TABLE obras ADD COLUMN IF NOT EXISTS state VARCHAR(2)`)

    // Vincula funcionários (persons) a uma obra específica
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL`)

    await client.query(`
      CREATE INDEX IF NOT EXISTS persons_embedding_hnsw_idx
        ON persons USING hnsw (embedding vector_l2_ops)
    `)
  } finally {
    client.release()
  }
}

export default pool
