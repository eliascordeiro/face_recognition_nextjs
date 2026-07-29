function clampDistance(raw: unknown, fallback: number) {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 2) return fallback
  return parsed
}

export function getAttendanceFaceThreshold() {
  return clampDistance(process.env.ATTENDANCE_FACE_MAX_DISTANCE, 0.55)
}

export function getEmployeeFaceLoginThreshold() {
  return clampDistance(process.env.EMPLOYEE_FACE_LOGIN_MAX_DISTANCE, 0.6)
}

export function getRecognizeFaceThreshold() {
  return clampDistance(process.env.RECOGNIZE_FACE_MAX_DISTANCE, 0.6)
}

export function toFaceConfidencePercent(distance: number, threshold: number) {
  if (!Number.isFinite(distance) || !Number.isFinite(threshold) || threshold <= 0) return 0
  const raw = (1 - distance / threshold) * 100
  return Math.max(0, Math.min(100, Math.round(raw)))
}
