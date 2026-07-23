'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RecognizePage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    async function resolveStartPage() {
      try {
        const res = await fetch('/api/auth/me')
        if (!res.ok) {
          router.replace('/login')
          return
        }
        const auth = await res.json()
        if (cancelled) return

        const perms: string[] = Array.isArray(auth.permissions) ? auth.permissions : []
        const canEmployees = perms.includes('employees.view') || perms.includes('employees.manage') || perms.includes('employees.face')
        const canObras = perms.includes('obras.view') || perms.includes('obras.manage')

        if (canEmployees) {
          router.replace('/recognize/employees')
          return
        }
        if (canObras) {
          router.replace('/recognize/obras')
          return
        }
        router.replace('/login')
      } catch {
        router.replace('/login')
      }
    }

    resolveStartPage()
    return () => { cancelled = true }
  }, [router])

  return (
    <div className="p-6">
      <p className="text-slate-400 animate-pulse">Redirecionando…</p>
    </div>
  )
}

