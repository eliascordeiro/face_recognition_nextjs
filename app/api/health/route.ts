import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  let db = 'ok'
  try {
    await pool.query('SELECT 1')
  } catch {
    db = 'unavailable'
  }
  return NextResponse.json({ status: 'ok', db })
}
