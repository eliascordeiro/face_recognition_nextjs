import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import {
  getAttendanceFaceThreshold,
  getEmployeeFaceLoginThreshold,
  getRecognizeFaceThreshold,
} from '@/lib/faceRecognition'

type ScenarioKey = 'checkin' | 'checkout' | 'employee_login' | 'recognize'

interface ScenarioSummary {
  scenario: ScenarioKey
  label: string
  envVar: string
  currentThreshold: number
  suggestedThreshold: number | null
  events: number
  accepted: number
  rejected: number
  acceptanceRate: number
  avgDistance: number | null
  medianDistance: number | null
  p90Distance: number | null
  p95Distance: number | null
  avgConfidence: number | null
  reasons: Array<{ reason: string; count: number }>
}

const SCENARIOS: Array<{ key: ScenarioKey; label: string; envVar: string }> = [
  { key: 'checkin', label: 'Entrada', envVar: 'ATTENDANCE_FACE_MAX_DISTANCE' },
  { key: 'checkout', label: 'Saída', envVar: 'ATTENDANCE_FACE_MAX_DISTANCE' },
  { key: 'employee_login', label: 'Login funcionário', envVar: 'EMPLOYEE_FACE_LOGIN_MAX_DISTANCE' },
  { key: 'recognize', label: 'Reconhecimento geral', envVar: 'RECOGNIZE_FACE_MAX_DISTANCE' },
]

const THRESHOLDS_BY_SCENARIO: Record<ScenarioKey, number> = {
  checkin: getAttendanceFaceThreshold(),
  checkout: getAttendanceFaceThreshold(),
  employee_login: getEmployeeFaceLoginThreshold(),
  recognize: getRecognizeFaceThreshold(),
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function toNumberOrNull(value: unknown, precision = 4) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Number(parsed.toFixed(precision))
}

function toInt(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.trunc(parsed))
}

function computeSuggestion(current: number, acceptedP95: number | null, rejectedP50: number | null) {
  if (acceptedP95 == null) return null

  const baseline = acceptedP95 + 0.015
  let candidate = baseline

  if (rejectedP50 != null) {
    candidate = Math.min(candidate, rejectedP50 - 0.01)
  }

  const bounded = Math.max(0.35, Math.min(0.8, candidate))
  const rounded = Number(bounded.toFixed(4))

  if (Math.abs(rounded - current) < 0.005) return null
  return rounded
}

export async function GET(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const days = clampInt(searchParams.get('days'), 14, 1, 90)
    const clientIdRaw = searchParams.get('clientId')
    const clientId = clientIdRaw && Number.isFinite(Number(clientIdRaw)) ? Number(clientIdRaw) : null

    const where: string[] = ['created_at >= NOW() - ($1::int * INTERVAL \'1 day\')']
    const params: Array<number> = [days]

    if (clientId != null && clientId > 0) {
      params.push(clientId)
      where.push(`client_id = $${params.length}`)
    }

    const whereSql = where.join(' AND ')

    const summaryResult = await pool.query(
      `SELECT
         scenario,
         COUNT(*)::int AS events,
         COUNT(*) FILTER (WHERE accepted)::int AS accepted,
         COUNT(*) FILTER (WHERE NOT accepted)::int AS rejected,
         AVG(distance) AS avg_distance,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY distance) FILTER (WHERE distance IS NOT NULL) AS median_distance,
         PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY distance) FILTER (WHERE distance IS NOT NULL) AS p90_distance,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY distance) FILTER (WHERE distance IS NOT NULL) AS p95_distance,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY distance) FILTER (WHERE accepted AND distance IS NOT NULL) AS accepted_p95,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY distance) FILTER (WHERE NOT accepted AND distance IS NOT NULL) AS rejected_p50,
         AVG(confidence_percent) AS avg_confidence
       FROM face_recognition_events
       WHERE ${whereSql}
       GROUP BY scenario`,
      params
    )

    const reasonsResult = await pool.query(
      `SELECT scenario, reason, COUNT(*)::int AS count
       FROM face_recognition_events
       WHERE ${whereSql}
       GROUP BY scenario, reason
       ORDER BY scenario, count DESC`,
      params
    )

    const reasonsMap = new Map<string, Array<{ reason: string; count: number }>>()
    for (const row of reasonsResult.rows as Array<{ scenario: string; reason: string | null; count: number }>) {
      const reason = row.reason ?? 'unknown'
      const bucket = reasonsMap.get(row.scenario) ?? []
      if (bucket.length < 4) {
        bucket.push({ reason, count: toInt(row.count) })
      }
      reasonsMap.set(row.scenario, bucket)
    }

    const rowMap = new Map<string, Record<string, unknown>>()
    for (const row of summaryResult.rows as Array<Record<string, unknown>>) {
      const scenario = String(row.scenario)
      rowMap.set(scenario, row)
    }

    const scenarios: ScenarioSummary[] = SCENARIOS.map((scenarioDef) => {
      const row = rowMap.get(scenarioDef.key)
      const currentThreshold = THRESHOLDS_BY_SCENARIO[scenarioDef.key]
      const events = toInt(row?.events)
      const accepted = toInt(row?.accepted)
      const rejected = toInt(row?.rejected)
      const acceptanceRate = events > 0 ? Number(((accepted / events) * 100).toFixed(1)) : 0
      const avgDistance = toNumberOrNull(row?.avg_distance)
      const medianDistance = toNumberOrNull(row?.median_distance)
      const p90Distance = toNumberOrNull(row?.p90_distance)
      const p95Distance = toNumberOrNull(row?.p95_distance)
      const avgConfidence = toNumberOrNull(row?.avg_confidence, 1)
      const suggestedThreshold = computeSuggestion(
        currentThreshold,
        toNumberOrNull(row?.accepted_p95),
        toNumberOrNull(row?.rejected_p50)
      )

      return {
        scenario: scenarioDef.key,
        label: scenarioDef.label,
        envVar: scenarioDef.envVar,
        currentThreshold: Number(currentThreshold.toFixed(4)),
        suggestedThreshold,
        events,
        accepted,
        rejected,
        acceptanceRate,
        avgDistance,
        medianDistance,
        p90Distance,
        p95Distance,
        avgConfidence,
        reasons: reasonsMap.get(scenarioDef.key) ?? [],
      }
    })

    const totalEvents = scenarios.reduce((sum, item) => sum + item.events, 0)
    const totalAccepted = scenarios.reduce((sum, item) => sum + item.accepted, 0)

    const recentResult = await pool.query(
      `SELECT id, scenario, accepted, client_id, person_id, obra_id,
              distance, threshold, confidence_percent, reason, created_at
       FROM face_recognition_events
       WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT 30`,
      params
    )

    return NextResponse.json({
      windowDays: days,
      clientId,
      totals: {
        events: totalEvents,
        accepted: totalAccepted,
        acceptanceRate: totalEvents > 0 ? Number(((totalAccepted / totalEvents) * 100).toFixed(1)) : 0,
      },
      scenarios,
      recentEvents: recentResult.rows.map((row) => ({
        id: Number(row.id),
        scenario: String(row.scenario),
        accepted: Boolean(row.accepted),
        clientId: row.client_id != null ? Number(row.client_id) : null,
        personId: row.person_id != null ? Number(row.person_id) : null,
        obraId: row.obra_id != null ? Number(row.obra_id) : null,
        distance: toNumberOrNull(row.distance),
        threshold: toNumberOrNull(row.threshold),
        confidencePercent: row.confidence_percent != null ? toInt(row.confidence_percent) : null,
        reason: row.reason ? String(row.reason) : null,
        createdAt: row.created_at,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
