'use client'

/**
 * Conflict Resolution Queue — Fase 5.5
 *
 * Visualizza:
 *   - Conflitti pendenti con severity
 *   - Stats aggregate (total, pending, resolved)
 *   - Azione resolve con 5 strategie
 */

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'

interface ConflictData {
  pending?: Array<{
    uri: string
    claimAUri: string
    claimBUri: string
    severity: 'low' | 'medium' | 'high'
    detectedAt: string
  }>
  stats?: {
    totalConflicts: number
    pending: number
    resolved: number
    byStrategy: Record<string, number>
  }
}

const STRATEGIES = [
  { id: 'higher-confidence', name: 'Higher Confidence', description: 'Wins claim with higher confidence' },
  { id: 'more-evidence', name: 'More Evidence', description: 'Wins claim with more supporting evidence' },
  { id: 'more-reliable-source', name: 'More Reliable Source', description: 'Wins claim from more reliable source' },
  { id: 'formal-proof', name: 'Formal Proof', description: 'Uses formal verification (Lean4)' },
  { id: 'human-decision', name: 'Human Decision', description: 'Requires manual winner specification' },
] as const

export function ConflictQueuePanel() {
  const [data, setData] = useState<ConflictData | null>(null)
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/conflict-resolution').then((r) => r.json())
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

  const resolve = async (conflictUri: string, strategy: string) => {
    setResolving(`${conflictUri}:${strategy}`)
    try {
      await fetch('/api/conflict-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          conflictUri,
          strategy,
          resolvedBy: 'user://admin',
        }),
      })
      fetchData()
    } catch (err) {
      console.error(err)
    } finally {
      setResolving(null)
    }
  }

  const autoResolve = async () => {
    setResolving('auto')
    try {
      await fetch('/api/conflict-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-resolve', strategy: 'higher-confidence' }),
      })
      fetchData()
    } catch (err) {
      console.error(err)
    } finally {
      setResolving(null)
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
            <AlertTriangle className="w-5 h-5" />
            Conflict Resolution Queue
          </h3>
          <p className="text-xs text-muted-foreground">
            {data?.stats?.pending ?? 0} pending · {data?.stats?.resolved ?? 0} resolved
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={autoResolve}
            disabled={resolving === 'auto' || (data?.stats?.pending ?? 0) === 0}
          >
            <Check className="w-4 h-4 mr-1" />
            {resolving === 'auto' ? 'Resolving...' : 'Auto-resolve (low/med)'}
          </Button>
        </div>
      </div>

      {/* Pending conflicts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pending Conflicts</CardTitle>
          <CardDescription>High severity requires Human Decision; low/medium can be auto-resolved</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.pending && data.pending.length > 0 ? (
            <div className="space-y-2">
              {data.pending.map((c) => (
                <div key={c.uri} className="border rounded p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="font-medium truncate">{c.uri}</div>
                      <div className="text-muted-foreground mt-1">
                        A: <span className="font-mono">{c.claimAUri}</span>
                      </div>
                      <div className="text-muted-foreground">
                        B: <span className="font-mono">{c.claimBUri}</span>
                      </div>
                      <div className="text-muted-foreground mt-1">
                        Detected: {new Date(c.detectedAt).toLocaleString()}
                      </div>
                    </div>
                    <Badge variant={c.severity === 'high' ? 'destructive' : c.severity === 'medium' ? 'warning' : 'secondary'}>
                      {c.severity}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {STRATEGIES.map((s) => (
                      <Button
                        key={s.id}
                        variant="outline"
                        size="sm"
                        disabled={resolving !== null}
                        onClick={() => resolve(c.uri, s.id)}
                        title={s.description}
                        className="text-xs h-7"
                      >
                        {resolving === `${c.uri}:${s.id}` ? (
                          <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                        ) : null}
                        {s.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No pending conflicts — all resolved
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      {data?.stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Stats</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatBox label="Total" value={data.stats.totalConflicts} />
              <StatBox label="Pending" value={data.stats.pending} />
              <StatBox label="Resolved" value={data.stats.resolved} />
              <StatBox label="Strategies used" value={Object.keys(data.stats.byStrategy).length} />
            </div>
            {Object.keys(data.stats.byStrategy).length > 0 && (
              <div className="mt-3">
                <div className="font-medium mb-1">By strategy:</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(data.stats.byStrategy).map(([strategy, count]) => (
                    <Badge key={strategy} variant="outline">{strategy}: {count}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded p-2 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
