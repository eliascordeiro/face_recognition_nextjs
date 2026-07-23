import { createHash, randomBytes } from 'crypto'

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function createResetToken(): string {
  return randomBytes(32).toString('hex')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
