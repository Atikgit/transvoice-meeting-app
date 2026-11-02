'use client'

import { useEffect, useState } from 'react'
import {
  nextAlert,
  NO_ALERTS,
  type AlertState,
  type MinuteAlert,
} from '@/features/billing/minute-alerts'

const TOAST_MS = 10_000

/**
 * Turns the payer's minutes-left into the 5 / 1 minute toasts (auto-dismissed) and the standing
 * zero message. Nothing for a non-payer (`left` undefined).
 */
export function useMinuteAlerts(left: number | null | undefined) {
  const [seen, setSeen] = useState<number | null | undefined>(undefined)
  const [armed, setArmed] = useState<AlertState>(NO_ALERTS)
  const [toast, setToast] = useState<MinuteAlert | null>(null)

  // Derived from the new value while rendering (React's "adjust state on change" pattern).
  if (left !== seen) {
    setSeen(left)
    if (left !== undefined) {
      const result = nextAlert(left, armed)
      setArmed(result.state)
      if (result.alert === 'five' || result.alert === 'one') setToast(result.alert)
      else if (left === null || left > 5) setToast(null)
    }
  }

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  return { toast, empty: left !== undefined && left !== null && left <= 0 }
}
