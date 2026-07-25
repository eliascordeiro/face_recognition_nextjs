const EARTH_RADIUS_METERS = 6371000

function toRad(value: number): number {
  return (value * Math.PI) / 180
}

export function haversineDistanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const dLat = toRad(toLat - fromLat)
  const dLng = toRad(toLng - fromLng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_METERS * c
}

export function getCheckinMaxDistanceMeters(): number {
  const raw = Number(process.env.CHECKIN_MAX_DISTANCE_METERS)
  if (!Number.isFinite(raw) || raw <= 0) return 200
  return Math.round(raw)
}
