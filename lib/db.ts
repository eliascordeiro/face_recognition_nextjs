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
        email      VARCHAR(255) UNIQUE,
        password   VARCHAR(255) NOT NULL,
        auth_provider VARCHAR(20) NOT NULL DEFAULT 'local',
        google_sub VARCHAR(255) UNIQUE,
        reset_password_token_hash VARCHAR(255),
        reset_password_expires_at TIMESTAMP WITH TIME ZONE,
        email_verified_at TIMESTAMP WITH TIME ZONE,
        email_verification_code_hash VARCHAR(255),
        email_verification_expires_at TIMESTAMP WITH TIME ZONE,
        email_verification_attempts INTEGER NOT NULL DEFAULT 0,
        email_verification_last_sent_at TIMESTAMP WITH TIME ZONE,
        role       VARCHAR(20)  NOT NULL DEFAULT 'operator',
        full_name  VARCHAR(255),
        client_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    // Migrations idempotentes para instalações existentes
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id) ON DELETE CASCADE`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local'`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token_hash VARCHAR(255)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMP WITH TIME ZONE`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code_hash VARCHAR(255)`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP WITH TIME ZONE`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_attempts INTEGER NOT NULL DEFAULT 0`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_last_sent_at TIMESTAMP WITH TIME ZONE`)
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email)) WHERE email IS NOT NULL`)
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx ON users (google_sub) WHERE google_sub IS NOT NULL`)
    // Migração de compatibilidade: em bases antigas, contas já criadas com
    // username em formato de e-mail passam a ter esse e-mail normalizado.
    await client.query(`UPDATE users SET email = LOWER(username) WHERE email IS NULL AND username LIKE '%@%'`)
    // Marca clientes já existentes como verificados para não bloquear acesso
    // após ativar o fluxo de validação por código no cadastro.
    await client.query(`
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, created_at)
      WHERE role = 'client'
        AND email IS NOT NULL
        AND email_verified_at IS NULL
    `)
    // Permissões granulares do operador (ex.: 'employees.view', 'obras.view')
    // e escopo opcional a uma única obra — ver lib/permissions.ts.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}'`)

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
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS access_password_hash VARCHAR(255)`)
    await client.query(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS allow_face_login BOOLEAN NOT NULL DEFAULT FALSE`)

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

    // Escopo opcional do operador a uma única obra (ex.: apontador de campo
    // que só deve ver/atuar nos funcionários daquela obra específica).
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL`)

    // ── Batidas de ponto / presença do funcionário ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_checkins (
        id SERIAL PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
        checkin_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        checkout_at TIMESTAMP WITH TIME ZONE,
        checkin_lat DECIMAL(10,8),
        checkin_lng DECIMAL(11,8),
        checkin_distance_meters INTEGER,
        checkin_face_distance NUMERIC(8,6),
        checkin_method VARCHAR(20) NOT NULL DEFAULT 'strict',
        checkin_override_reason TEXT,
        checkin_override_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        checkout_lat DECIMAL(10,8),
        checkout_lng DECIMAL(11,8),
        checkout_distance_meters INTEGER,
        checkout_face_distance NUMERIC(8,6),
        checkout_method VARCHAR(20) NOT NULL DEFAULT 'strict',
        checkout_override_reason TEXT,
        checkout_override_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkin_distance_meters INTEGER`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkout_distance_meters INTEGER`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkin_face_distance NUMERIC(8,6)`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkout_face_distance NUMERIC(8,6)`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkin_method VARCHAR(20) NOT NULL DEFAULT 'strict'`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkin_override_reason TEXT`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkin_override_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkout_method VARCHAR(20) NOT NULL DEFAULT 'strict'`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkout_override_reason TEXT`)
    await client.query(`ALTER TABLE employee_checkins ADD COLUMN IF NOT EXISTS checkout_override_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
    await client.query(`CREATE INDEX IF NOT EXISTS employee_checkins_person_idx ON employee_checkins (person_id, checkin_at DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS employee_checkins_client_idx ON employee_checkins (client_id, checkin_at DESC)`)

    // Telemetria operacional para calibração de limiares faciais por cenário
    await client.query(`
      CREATE TABLE IF NOT EXISTS face_recognition_events (
        id SERIAL PRIMARY KEY,
        scenario VARCHAR(30) NOT NULL,
        accepted BOOLEAN NOT NULL,
        client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
        distance NUMERIC(8,6),
        threshold NUMERIC(8,6),
        confidence_percent INTEGER,
        reason VARCHAR(40),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS scenario VARCHAR(30)`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS accepted BOOLEAN`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS distance NUMERIC(8,6)`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS threshold NUMERIC(8,6)`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS confidence_percent INTEGER`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS reason VARCHAR(40)`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS metadata JSONB`)
    await client.query(`ALTER TABLE face_recognition_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`)
    await client.query(`UPDATE face_recognition_events SET accepted = FALSE WHERE accepted IS NULL`)
    await client.query(`ALTER TABLE face_recognition_events ALTER COLUMN accepted SET NOT NULL`)
    await client.query(`CREATE INDEX IF NOT EXISTS face_recognition_events_created_idx ON face_recognition_events (created_at DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS face_recognition_events_scenario_idx ON face_recognition_events (scenario, created_at DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS face_recognition_events_client_idx ON face_recognition_events (client_id, scenario, created_at DESC)`)

    // ── Gastos / comprovantes ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS construction_expenses (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'material',
        vendor_name VARCHAR(255),
        amount_cents INTEGER NOT NULL,
        expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        receipt_number VARCHAR(100),
        receipt_total_cents INTEGER,
        receipt_ocr_text TEXT,
        ocr_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        receipt_classification_source VARCHAR(20),
        receipt_classification_reason VARCHAR(30),
        receipt_classification_confidence NUMERIC(4,3),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS title VARCHAR(255)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'material'`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(255)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS amount_cents INTEGER`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS expense_date DATE NOT NULL DEFAULT CURRENT_DATE`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS notes TEXT`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(100)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_total_cents INTEGER`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_ocr_text TEXT`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(20) NOT NULL DEFAULT 'pending'`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_classification_source VARCHAR(20)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_classification_reason VARCHAR(30)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_classification_confidence NUMERIC(4,3)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_image_url TEXT`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_image_public_id VARCHAR(255)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_image_format VARCHAR(30)`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_image_bytes INTEGER`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_image_width INTEGER`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_image_height INTEGER`)
    await client.query(`ALTER TABLE construction_expenses ADD COLUMN IF NOT EXISTS receipt_uploaded_at TIMESTAMP WITH TIME ZONE`)
    await client.query(`CREATE INDEX IF NOT EXISTS construction_expenses_client_idx ON construction_expenses (client_id, expense_date DESC, id DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS construction_expenses_obra_idx ON construction_expenses (obra_id, expense_date DESC)`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS construction_expense_audit (
        id SERIAL PRIMARY KEY,
        expense_id INTEGER,
        client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(20) NOT NULL,
        before_state JSONB,
        after_state JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS expense_id INTEGER`)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id) ON DELETE CASCADE`)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS action VARCHAR(20)`)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS before_state JSONB`)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS after_state JSONB`)
    await client.query(`ALTER TABLE construction_expense_audit ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`)
    await client.query(`CREATE INDEX IF NOT EXISTS construction_expense_audit_client_idx ON construction_expense_audit (client_id, created_at DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS construction_expense_audit_expense_idx ON construction_expense_audit (expense_id, created_at DESC)`)

    await client.query(`UPDATE construction_expenses SET title = 'Gasto sem descrição' WHERE title IS NULL OR BTRIM(title) = ''`)
    await client.query(`UPDATE construction_expenses SET amount_cents = 0 WHERE amount_cents IS NULL`)
    await client.query(`ALTER TABLE construction_expenses ALTER COLUMN title SET NOT NULL`)
    await client.query(`ALTER TABLE construction_expenses ALTER COLUMN amount_cents SET NOT NULL`)

    await client.query(`
      CREATE INDEX IF NOT EXISTS persons_embedding_hnsw_idx
        ON persons USING hnsw (embedding vector_l2_ops)
    `)
  } finally {
    client.release()
  }
}

export default pool
