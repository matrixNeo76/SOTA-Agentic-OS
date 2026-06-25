'use client'

import { useEffect } from 'react'
import { useDataStore, startGlobalRefresh, stopGlobalRefresh, type DashboardData } from '@/lib/stores/data-store'

export type { DashboardData }

export function useDashboard() {
  const { dashboard, fetchDashboard } = useDataStore()

  useEffect(() => {
    startGlobalRefresh()
    fetchDashboard()
    return () => stopGlobalRefresh()
  }, [fetchDashboard])

  return {
    data: dashboard,
    loading: !dashboard,
    refresh: () => fetchDashboard(true),
  }
}
