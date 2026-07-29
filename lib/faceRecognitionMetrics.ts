import pool from '@/lib/db'

export type FaceRecognitionScenario = 'checkin' | 'checkout' | 'employee_login' | 'recognize'

interface RecordFaceRecognitionEventInput {
  scenario: FaceRecognitionScenario
  accepted: boolean
  clientId: number | null
  personId?: number | null
  obraId?: number | null
  distance?: number | null
  threshold?: number | null
  confidencePercent?: number | null
  reason?: string | null
  metadata?: Record<string, unknown>
}

function toFiniteOrNull(value: number | null | undefined, precision = 6) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(precision))
}

function toIntOrNull(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

export async function recordFaceRecognitionEvent(input: RecordFaceRecognitionEventInput) {
  try {
    await pool.query(
      `INSERT INTO face_recognition_events (
         scenario, accepted, client_id, person_id, obra_id,
         distance, threshold, confidence_percent, reason, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        input.scenario,
        input.accepted,
        input.clientId,
        input.personId ?? null,
        input.obraId ?? null,
        toFiniteOrNull(input.distance, 6),
        toFiniteOrNull(input.threshold, 6),
        toIntOrNull(input.confidencePercent),
        input.reason ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown_error'
    console.warn(`[face.metrics] failed_to_persist scenario=${input.scenario} detail=${detail}`)
  }
}
