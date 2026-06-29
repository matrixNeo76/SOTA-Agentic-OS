'use client'

/**
 * useGovernanceData — adaptive polling hook for governance module.
 *
 * B9 fix: prima phase4/5/9 e l'admin governance tab facevano un singolo
 * fetch in useEffect e non si aggiornavano mai più. L'admin doveva cliccare
 * "Refresh" per vedere nuove blocked actions o gates.
 *
 * Ora: adaptive polling con due intervalli (5s quando il tab è visibile,
 * 30s quando è in background). Si ferma quando il tab è hidden per risparmiare
 * risorse. Si riavvia immediatamente quando il tab torna visibile.
 *
 * Pattern già usato da useDashboard (data-store globale) ma qui kept locale
 * per non inquinare il data-store con dati governance-specifici.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const ACTIVE_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 30_000

type Fetcher<T> = () => Promise<T>

export function useGovernanceData<T>(
  fetcher: Fetcher<T>,
  options: { enabled?: boolean } = {},
): {
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const { enabled = true } = options
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const doFetch = useCallback(async () => {
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
    } catch (err: any) {
      // Non sovrascrivere data se abbiamo già dati validi (evita flicker)
      setError(err.message || 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    await doFetch()
  }, [doFetch])

  useEffect(() => {
    if (!enabled) return

    // Fetch iniziale
    doFetch()

    // Adaptive polling
    const setupInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      const isVisible = !document.hidden
      const interval = isVisible ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
      intervalRef.current = setInterval(doFetch, interval)
    }

    setupInterval()

    const onVisibilityChange = () => {
      if (!document.hidden) {
        // Tab tornato visibile: fetch immediato + riavvia intervallo a 5s
        doFetch()
        setupInterval()
      } else {
        // Tab nascosto: rallenta a 30s
        setupInterval()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [doFetch, enabled])

  return { data, loading, error, refresh }
}
