'use client'

/**
 * Autonomous Dashboard — Fase 4.3
 *
 * Cockpit minimale per visualizzare lo stato dell'organizzazione autonoma:
 *   - Mesh gerarchica (agenti per tier)
 *   - World Model (latest WorldState + pending predictions)
 *   - Autonomous Org proposals (pending + stats)
 *   - Digital Twin scenarios (recenti)
 *   - Skill Registry + Synthesis stats
 *   - Conflict Resolution stats
 *   - Cognitive GC stats
 *   - Integration layer status
 *
 * Auto-refresh ogni 30 secondi.
 */

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Activity, Users, Brain, GitBranch, Wrench, AlertTriangle, Zap } from 'lucide-react'

interface DashboardData {
  mesh?: { topology: { nodes: any[]; edges: any[] }; stats: any }
  worldModel?: { stats: any; latestWorldState: any; pendingPredictions: any[] }
  autonomousOrg?: { pending: any[]; stats: any }
  digitalTwin?: { stats: any; scenarios: any[]; availablePresets: string[] }
  skillRegistry?: { stats: any; skills: any[] }
  synthesis?: any
  conflictResolution?: { pending: any[]; stats: any }
  cognitiveGc?: any
  integration?: { started: boolean; activeSubscriptions: number }
  error?: string
}

export function AutonomousDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const endpoints = [
        'agent-mesh', 'world-model', 'autonomous-org', 'digital-twin',
        'skill-registry', 'skill-synthesis', 'conflict-resolution', 'cognitive-gc',
      ]
      const responses = await Promise.all(
        endpoints.map((ep) => fetch(`/api/${ep}`).then((r) => r.json()).catch(() => null)),
      )

      setData({
        mesh: responses[0],
        worldModel: responses[1],
        autonomousOrg: responses[2],
        digitalTwin: responses[3],
        skillRegistry: responses[4],
        synthesis: responses[5],
        conflictResolution: responses[6],
        cognitiveGc: responses[7],
      })
    } catch (err) {
      setData({ error: String(err) })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (data?.error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Error loading dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs">{data.error}</pre>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Autonomous Organization Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Fase 3+ — Governance-first autonomous system overview
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Agent Mesh */}
        <StatCard
          icon={<Users className="w-5 h-5" />}
          title="Agent Mesh"
          value={data?.mesh?.stats?.totalAgents ?? 0}
          subtitle={`${data?.mesh?.stats?.executiveAgents ?? 0} exec · ${data?.mesh?.stats?.strategicAgents ?? 0} strat · ${data?.mesh?.stats?.operationalAgents ?? 0} ops`}
          color="blue"
        />

        {/* World Model */}
        <StatCard
          icon={<Brain className="w-5 h-5" />}
          title="World Model"
          value={data?.worldModel?.stats?.worldStates ?? 0}
          subtitle={`${data?.worldModel?.stats?.pendingPredictions ?? 0} predictions · ${data?.worldModel?.stats?.risks ?? 0} risks`}
          color="purple"
        />

        {/* Autonomous Org */}
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          title="Autonomous Org"
          value={data?.autonomousOrg?.stats?.pendingApproval ?? 0}
          subtitle={`${data?.autonomousOrg?.stats?.executed ?? 0} executed · ${data?.autonomousOrg?.stats?.rejected ?? 0} rejected`}
          color="orange"
        />

        {/* Digital Twin */}
        <StatCard
          icon={<GitBranch className="w-5 h-5" />}
          title="Digital Twin"
          value={data?.digitalTwin?.stats?.totalScenarios ?? 0}
          subtitle={`${data?.digitalTwin?.availablePresets?.length ?? 0} presets available`}
          color="green"
        />

        {/* Skill Registry */}
        <StatCard
          icon={<Wrench className="w-5 h-5" />}
          title="Skill Registry"
          value={data?.skillRegistry?.stats?.total ?? 0}
          subtitle={`${data?.synthesis?.totalGenerated ?? 0} synthesized`}
          color="cyan"
        />

        {/* Conflict Resolution */}
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          title="Conflicts"
          value={data?.conflictResolution?.stats?.pending ?? 0}
          subtitle={`${data?.conflictResolution?.stats?.resolved ?? 0} resolved`}
          color="red"
        />

        {/* Cognitive GC */}
        <StatCard
          icon={<Zap className="w-5 h-5" />}
          title="Memory Entries"
          value={data?.cognitiveGc?.totalMemories ?? 0}
          subtitle={`hot: ${data?.cognitiveGc?.byTier?.hot ?? 0} · warm: ${data?.cognitiveGc?.byTier?.warm ?? 0} · cold: ${data?.cognitiveGc?.byTier?.cold ?? 0}`}
          color="yellow"
        />

        {/* Latest WorldState */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Latest WorldState
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1">
            {data?.worldModel?.latestWorldState ? (
              <>
                <div>Tasks 24h: {data.worldModel.latestWorldState.snapshot?.completedTasksLast24h ?? 0} ✓ · {data.worldModel.latestWorldState.snapshot?.failedTasksLast24h ?? 0} ✗</div>
                <div>Cost 24h: ${(data.worldModel.latestWorldState.snapshot?.totalCostLast24h ?? 0).toFixed(2)}</div>
                <div>Error rate: {((data.worldModel.latestWorldState.snapshot?.errorRate ?? 0) * 100).toFixed(1)}%</div>
                {data.worldModel.latestWorldState.snapshot?.anomalies?.length > 0 && (
                  <Badge variant="destructive" className="mt-1">
                    {data.worldModel.latestWorldState.snapshot.anomalies.length} anomalies
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">No WorldState captured</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending Proposals Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Autonomous Proposals</CardTitle>
          <CardDescription>
            Generated by the system — require Human Approval Gate before execution
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data?.autonomousOrg?.pending?.length ? (
            <div className="space-y-2">
              {data.autonomousOrg.pending.slice(0, 5).map((p: any) => (
                <div key={p.uri} className="flex items-start justify-between p-3 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{p.type}</Badge>
                      <span className="text-sm font-medium">{p.description}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.rationale}</p>
                  </div>
                  <div className="text-right text-xs">
                    <div>risk: <Badge variant={p.expectedImpact?.riskLevel === 'high' ? 'destructive' : 'secondary'}>{p.expectedImpact?.riskLevel}</Badge></div>
                    <div className="mt-1">cost Δ: ${p.expectedImpact?.costDelta ?? 0}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No pending proposals — system is stable
            </p>
          )}
        </CardContent>
      </Card>

      {/* Mesh Topology */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hierarchical Agent Mesh</CardTitle>
          <CardDescription>
            {data?.mesh?.topology?.nodes?.length ?? 0} agents · {data?.mesh?.topology?.edges?.length ?? 0} relationships
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data?.mesh?.topology?.nodes?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              {(['executive', 'strategic', 'operational', 'specialized'] as const).map((tier) => {
                const meshData = data.mesh
                if (!meshData) return null
                const agents = meshData.topology.nodes.filter((n: any) => n.tier === tier)
                if (agents.length === 0) return null
                return (
                  <div key={tier} className="border rounded-lg p-2">
                    <div className="font-semibold capitalize mb-1">{tier}</div>
                    <div className="space-y-1">
                      {agents.map((a: any) => (
                        <div key={a.agentUri} className="truncate" title={a.agentUri}>
                          {a.agentUri.replace('agent://', '')}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Mesh not bootstrapped — call POST /api/agent-mesh with action=bootstrap
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon, title, value, subtitle, color }: {
  icon: React.ReactNode
  title: string
  value: number | string
  subtitle?: string
  color?: 'blue' | 'purple' | 'orange' | 'green' | 'cyan' | 'red' | 'yellow'
}) {
  const colorClasses: Record<string, string> = {
    blue: 'border-blue-500/20 bg-blue-500/5',
    purple: 'border-purple-500/20 bg-purple-500/5',
    orange: 'border-orange-500/20 bg-orange-500/5',
    green: 'border-green-500/20 bg-green-500/5',
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    red: 'border-red-500/20 bg-red-500/5',
    yellow: 'border-yellow-500/20 bg-yellow-500/5',
  }

  return (
    <Card className={color ? colorClasses[color] : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  )
}
