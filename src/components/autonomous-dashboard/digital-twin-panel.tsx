'use client'

/**
 * Digital Twin Dashboard — Fase 5.5
 *
 * Visualizza:
 *   - Scenari di simulazione esistenti
 *   - 6 preset what-if eseguibili on-click
 *   - Risultati simulazioni (projected metrics + CI)
 *   - Comparazione tra scenari
 */

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Play, GitBranch, TrendingUp, AlertTriangle } from 'lucide-react'

interface DigitalTwinData {
  stats?: { totalScenarios: number; byStatus: Record<string, number>; availablePresets: number }
  scenarios?: Array<{
    uri: string
    name: string
    description: string
    status: 'drafted' | 'running' | 'completed' | 'failed'
    createdAt: string
  }>
  availablePresets?: string[]
}

export function DigitalTwinDashboard() {
  const [data, setData] = useState<DigitalTwinData | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<any>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/digital-twin').then((r) => r.json())
      setData(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const runPreset = async (presetName: string) => {
    setRunning(presetName)
    setLastResult(null)
    try {
      const res = await fetch('/api/digital-twin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'what-if', presetName }),
      }).then((r) => r.json())
      setLastResult(res)
      fetchData() // refresh scenarios list
    } catch (err) {
      console.error(err)
    } finally {
      setRunning(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Digital Twin Engine
          </h3>
          <p className="text-xs text-muted-foreground">
            {data?.stats?.totalScenarios ?? 0} scenarios · {data?.availablePresets?.length ?? 0} presets available
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* What-if presets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">What-If Presets</CardTitle>
          <CardDescription>Click to run a simulation preset</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {data?.availablePresets?.map((preset) => (
              <Button
                key={preset}
                variant="outline"
                size="sm"
                disabled={running !== null}
                onClick={() => runPreset(preset)}
                className="justify-start"
              >
                {running === preset ? (
                  <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                ) : (
                  <Play className="w-3 h-3 mr-2" />
                )}
                <span className="truncate">{preset}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Last simulation result */}
      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Last Simulation Result: {lastResult.scenario?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lastResult.result?.success ? (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <Metric label="Success Rate" value={`${(lastResult.result.projectedMetrics.expectedSuccessRate * 100).toFixed(1)}%`} ci={lastResult.result.projectedMetrics.successRateCI} />
                  <Metric label="Error Rate" value={`${(lastResult.result.projectedMetrics.expectedErrorRate * 100).toFixed(1)}%`} ci={lastResult.result.projectedMetrics.errorRateCI} />
                  <Metric label="Avg Latency" value={`${lastResult.result.projectedMetrics.expectedAvgLatencyMs.toFixed(0)}ms`} />
                  <Metric label="Cost/day" value={`$${lastResult.result.projectedMetrics.expectedCost.toFixed(2)}`} ci={lastResult.result.projectedMetrics.costCI} />
                  <Metric label="Throughput" value={`${lastResult.result.projectedMetrics.expectedThroughput.toFixed(1)}/h`} />
                </div>
                {lastResult.result.anomalies.length > 0 && (
                  <div className="mt-2 p-2 border border-destructive/30 rounded bg-destructive/5">
                    <div className="font-medium text-destructive flex items-center gap-1 mb-1">
                      <AlertTriangle className="w-3 h-3" />
                      {lastResult.result.anomalies.length} anomalies detected
                    </div>
                    <ul className="text-xs space-y-0.5">
                      {lastResult.result.anomalies.map((a: string, i: number) => (
                        <li key={i}>• {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-destructive">Simulation failed: {lastResult.result?.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent scenarios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Scenarios</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.scenarios && data.scenarios.length > 0 ? (
            <div className="space-y-1 text-xs">
              {data.scenarios.slice(0, 10).map((s) => (
                <div key={s.uri} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-muted-foreground truncate">{s.description}</div>
                  </div>
                  <Badge variant={s.status === 'completed' ? 'success' : s.status === 'failed' ? 'destructive' : 'secondary'}>
                    {s.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No scenarios yet. Run a preset above.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, ci }: { label: string; value: string; ci?: [number, number] }) {
  return (
    <div className="border rounded p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-bold">{value}</div>
      {ci && (
        <div className="text-xs text-muted-foreground">
          CI: [{Array.isArray(ci) ? ci.map((v) => typeof v === 'number' ? v.toFixed(2) : v).join(', ') : ''}]
        </div>
      )}
    </div>
  )
}
