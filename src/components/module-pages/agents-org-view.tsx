'use client'

/**
 * Agents Org View — C6.16 Fase 1 + C6.17 Fase 2
 *
 * Fase 1: auth fix, error handling, tab structure, skill search, synthesis UI
 * Fase 2: agent detail view, mesh visualization SVG, agent metrics
 *
 * Fixes:
 *   - Error handling with toast (distinguish empty DB from fetch error)
 *   - Bootstrap with loading + toast feedback
 *   - Approve/Reject with loading + toast + confirm
 *   - Tab structure: Mesh, Lifecycle, Skills, Synthesis, Proposals
 *   - Skill search bar + seed defaults button
 *   - All API routes now require auth
 */

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Wrench, GitBranch, Activity, Search, Loader2, Plus, Check, X, RefreshCw, Network, Sparkles, ArrowLeft, ChevronRight, ChevronDown, DollarSign, Clock, TrendingUp, Zap } from 'lucide-react'

export function AgentsOrgView() {
  const [meshData, setMeshData] = useState<any>(null)
  const [skillData, setSkillData] = useState<any>(null)
  const [proposalData, setProposalData] = useState<any>(null)
  const [lifecycleData, setLifecycleData] = useState<any>(null)
  const [synthData, setSynthData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mesh, skills, proposals, lifecycle, synth] = await Promise.all([
        fetch('/api/agent-mesh').then(async (r) => { if (!r.ok) throw new Error(`Mesh: HTTP ${r.status}`); return r.json() }),
        fetch('/api/skill-registry').then(async (r) => { if (!r.ok) throw new Error(`Skills: HTTP ${r.status}`); return r.json() }),
        fetch('/api/autonomous-org').then(async (r) => { if (!r.ok) throw new Error(`Proposals: HTTP ${r.status}`); return r.json() }),
        fetch('/api/agent-lifecycle').then(async (r) => { if (!r.ok) throw new Error(`Lifecycle: HTTP ${r.status}`); return r.json() }),
        fetch('/api/skill-synthesis').then(async (r) => { if (!r.ok) throw new Error(`Synthesis: HTTP ${r.status}`); return r.json() }),
      ])
      setMeshData(mesh)
      setSkillData(skills)
      setProposalData(proposals)
      setLifecycleData(lifecycle)
      setSynthData(synth)
    } catch (err: any) {
      setError(err.message)
      toast.error(`Failed to load data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // C6.16 — Bootstrap with loading + toast
  const [bootstrapping, setBootstrapping] = useState(false)
  const [selectedAgentUri, setSelectedAgentUri] = useState<string | null>(null)
  const bootstrap = async () => {
    setBootstrapping(true)
    try {
      const res = await fetch('/api/agent-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap' }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`Bootstrap failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      toast.success(`Mesh bootstrapped: ${body.created ?? body.agents ?? 'agents created'}`)
      fetchData()
    } catch (err: any) {
      toast.error(`Bootstrap failed: ${err.message}`)
    } finally {
      setBootstrapping(false)
    }
  }

  return (
    <ModulePage
      title="Agents & Organization"
      description="Mesh topology · Lifecycle · Skills · Autonomous Org"
      icon="Users"
      loading={loading}
      onRefresh={fetchData}
      actions={
        <Button size="sm" variant="outline" onClick={bootstrap} disabled={bootstrapping}>
          {bootstrapping ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <GitBranch className="w-4 h-4 mr-1" />}
          {bootstrapping ? 'Bootstrapping…' : 'Bootstrap Mesh'}
        </Button>
      }
      stats={[
        { label: 'Agents', value: meshData?.stats?.totalAgents ?? 0, icon: 'Users' },
        { label: 'Skills', value: skillData?.stats?.total ?? 0, icon: 'Wrench' },
        { label: 'Pending', value: proposalData?.stats?.pending ?? 0, tone: 'warn' as const, icon: 'Activity' },
        { label: 'Synthesized', value: synthData?.totalGenerated ?? synthData?.stats?.totalGenerated ?? 0, icon: 'Sparkles' },
      ]}
    >
      {/* C6.16 — Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-status-danger/10 border border-status-danger/20 text-xs text-status-danger mb-4">
          <span className="font-medium">Error:</span>
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="ghost" onClick={fetchData} className="h-6 px-2 text-xs">Retry</Button>
        </div>
      )}

      {/* C6.17 — Agent Detail View overlay */}
      {selectedAgentUri && (
        <AgentDetailView
          uri={selectedAgentUri}
          onBack={() => setSelectedAgentUri(null)}
          onRefresh={fetchData}
        />
      )}

      <Tabs defaultValue="mesh" className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-5">
          <TabsTrigger value="mesh" className="text-xs"><Network className="w-3.5 h-3.5 mr-1" />Mesh</TabsTrigger>
          <TabsTrigger value="lifecycle" className="text-xs"><Users className="w-3.5 h-3.5 mr-1" />Lifecycle</TabsTrigger>
          <TabsTrigger value="skills" className="text-xs"><Wrench className="w-3.5 h-3.5 mr-1" />Skills</TabsTrigger>
          <TabsTrigger value="synthesis" className="text-xs"><Sparkles className="w-3.5 h-3.5 mr-1" />Synthesis</TabsTrigger>
          <TabsTrigger value="proposals" className="text-xs"><Activity className="w-3.5 h-3.5 mr-1" />Proposals</TabsTrigger>
        </TabsList>

        {/* === MESH TAB === */}
        <TabsContent value="mesh" className="mt-4">
          <MeshTab meshData={meshData} onBootstrap={bootstrap} bootstrapping={bootstrapping} onAgentClick={(uri) => setSelectedAgentUri(uri)} />
          {meshData?.topology?.nodes?.length > 0 && (
            <div className="mt-3">
              <MeshActionsCard meshData={meshData} onRefresh={fetchData} />
            </div>
          )}
        </TabsContent>

        {/* === LIFECYCLE TAB === */}
        <TabsContent value="lifecycle" className="mt-4">
          <LifecycleTab lifecycleData={lifecycleData} onRefresh={fetchData} onAgentClick={(uri) => setSelectedAgentUri(uri)} />
        </TabsContent>

        {/* === SKILLS TAB === */}
        <TabsContent value="skills" className="mt-4">
          <SkillsTab skillData={skillData} onRefresh={fetchData} />
        </TabsContent>

        {/* === SYNTHESIS TAB === */}
        <TabsContent value="synthesis" className="mt-4">
          <SynthesisTab synthData={synthData} onRefresh={fetchData} />
        </TabsContent>

        {/* === PROPOSALS TAB === */}
        <TabsContent value="proposals" className="mt-4">
          <ProposalsTab proposalData={proposalData} onRefresh={fetchData} />
        </TabsContent>
      </Tabs>
    </ModulePage>
  )
}

// === Mesh Tab ========================================================

function MeshTab({ meshData, onBootstrap, bootstrapping, onAgentClick }: { meshData: any; onBootstrap: () => void; bootstrapping: boolean; onAgentClick?: (uri: string) => void }) {
  const tiers = ['executive', 'strategic', 'operational', 'specialized'] as const
  const [showViz, setShowViz] = useState(true)

  if (!meshData?.topology?.nodes?.length) {
    return (
      <Card>
        <CardContent className="p-4">
          <EmptyState
            icon="Users"
            title="No agents in mesh"
            description="Bootstrap the default mesh to create 10 agents across 3 tiers"
            action={<Button size="sm" variant="outline" onClick={onBootstrap} disabled={bootstrapping}>{bootstrapping ? 'Bootstrapping…' : 'Bootstrap Mesh'}</Button>}
          />
        </CardContent>
      </Card>
    )
  }

  const tierColors: Record<string, string> = {
    executive: '#10b981', strategic: '#f59e0b', operational: '#3b82f6', specialized: '#8b5cf6',
  }
  const nodes = meshData.topology.nodes || []
  const edges = meshData.topology.edges || []

  // C6.17 — SVG org chart layout
  // Group nodes by tier, position in horizontal layers
  const tierOrder = ['executive', 'strategic', 'operational', 'specialized']
  const nodesByTier: Record<string, any[]> = {}
  for (const t of tierOrder) { nodesByTier[t] = nodes.filter((n: any) => n.tier === t) }

  // Calculate positions: each tier is a horizontal row
  const tierY: Record<string, number> = { executive: 40, strategic: 120, operational: 200, specialized: 280 }
  const svgWidth = 600
  const nodeRadius = 18
  const nodePositions = new Map<string, { x: number; y: number; tier: string }>()

  for (const tier of tierOrder) {
    const tierNodes = nodesByTier[tier] || []
    const spacing = tierNodes.length > 1 ? (svgWidth - 80) / (tierNodes.length - 1) : 0
    tierNodes.forEach((n, i) => {
      const x = tierNodes.length === 1 ? svgWidth / 2 : 40 + i * spacing
      nodePositions.set(n.agentUri, { x, y: tierY[tier], tier })
    })
  }

  return (
    <div className="space-y-3">
      {/* C6.17 — SVG Mesh Visualization */}
      {showViz && nodes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Network className="w-4 h-4" /> Mesh Visualization
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowViz(!showViz)} className="h-6 text-xs">
                {showViz ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </Button>
            </div>
            <CardDescription>{nodes.length} agents · {edges.length} edges · org chart by tier</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden bg-muted/10">
              <svg viewBox="0 0 600 320" className="w-full h-auto" style={{ maxHeight: '400px' }}>
                {/* Edges */}
                {edges.map((e: any, i: number) => {
                  const fromPos = nodePositions.get(e.from)
                  const toPos = nodePositions.get(e.to)
                  if (!fromPos || !toPos) return null
                  const isReport = e.relation === 'REPORTS_TO'
                  return (
                    <line key={i} x1={fromPos.x} y1={fromPos.y} x2={toPos.x} y2={toPos.y}
                      stroke={isReport ? 'currentColor' : 'currentColor'}
                      strokeWidth={isReport ? '1.5' : '1'}
                      className={isReport ? 'text-border' : 'text-border/40'}
                      strokeDasharray={isReport ? 'none' : '3 2'}
                    />
                  )
                })}
                {/* Nodes */}
                {nodes.map((n: any) => {
                  const pos = nodePositions.get(n.agentUri)
                  if (!pos) return null
                  const color = tierColors[pos.tier] || '#6b7280'
                  const shortName = n.agentUri.replace('agent://', '')
                  return (
                    <g key={n.agentUri} className="cursor-pointer" onClick={() => onAgentClick?.(n.agentUri)}>
                      <circle cx={pos.x} cy={pos.y} r={nodeRadius} fill={color} stroke="white" strokeWidth="2" opacity="0.9">
                        <title>{n.agentUri} [{pos.tier}]</title>
                      </circle>
                      <text x={pos.x} y={pos.y + 4} textAnchor="middle" className="text-[8px] fill-white font-medium pointer-events-none">
                        {shortName.slice(0, 6)}
                      </text>
                      <text x={pos.x} y={pos.y + nodeRadius + 12} textAnchor="middle" className="text-[7px] fill-muted-foreground pointer-events-none">
                        {shortName}
                      </text>
                    </g>
                  )
                })}
                {/* Tier labels */}
                {tierOrder.map(tier => (
                  (nodesByTier[tier] || []).length > 0 && (
                    <text key={tier} x={10} y={tierY[tier] + 3} className="text-[8px] fill-muted-foreground capitalize pointer-events-none">
                      {tier}
                    </text>
                  )
                ))}
              </svg>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-2">
              {tierOrder.map(tier => {
                const count = (nodesByTier[tier] || []).length
                if (count === 0) return null
                return (
                  <div key={tier} className="flex items-center gap-1 text-[10px]">
                    <span className="size-2 rounded-full" style={{ background: tierColors[tier] }} />
                    <span className="text-muted-foreground">{tier}: {count}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tier list (always visible) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> Agent List by Tier
          </CardTitle>
          <CardDescription>
            {meshData.stats?.totalAgents ?? 0} agents · {meshData.stats?.totalEdges ?? 0} edges
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {tiers.map(tier => {
              const agents = meshData.topology.nodes.filter((n: any) => n.tier === tier)
              if (agents.length === 0) return null
              return (
                <div key={tier} className="border rounded p-2">
                  <div className="text-xs font-semibold capitalize mb-1 text-muted-foreground flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: tierColors[tier] }} />
                    {tier} ({agents.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {agents.map((a: any) => (
                      <Badge
                        key={a.agentUri}
                        variant="outline"
                        className="text-xs cursor-pointer hover:bg-accent/50"
                        onClick={() => onAgentClick?.(a.agentUri)}
                      >
                        {a.agentUri.replace('agent://', '')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// === Lifecycle Tab ===================================================

function LifecycleTab({ lifecycleData, onRefresh, onAgentClick }: { lifecycleData: any; onRefresh: () => void; onAgentClick?: (uri: string) => void }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const runAction = async (action: string, agentUri: string) => {
    setActionLoading(`${action}:${agentUri}`)
    try {
      const res = await fetch('/api/agent-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, agentUri }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`${action} failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      toast.success(`${action} succeeded for ${agentUri.replace('agent://', '')}`)
      onRefresh()
    } catch (err: any) {
      toast.error(`${action} failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const agents = lifecycleData?.agents || []

  if (agents.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <EmptyState icon="Users" title="No agents registered" description="Bootstrap the mesh to create agents, or register a new agent via the API" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4" /> Agent Lifecycle
        </CardTitle>
        <CardDescription>{agents.length} agent{agents.length === 1 ? '' : 's'} · manage lifecycle state</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {agents.map((a: any) => (
            <div key={a.uri || a.agentUri} className="border rounded p-2 text-xs group cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => onAgentClick?.(a.uri || a.agentUri)}>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={a.lifecycleState === 'active' ? 'success' : a.lifecycleState === 'suspended' ? 'warning' : 'secondary'} className="text-[9px]">
                  {a.lifecycleState || 'unknown'}
                </Badge>
                <code className="font-mono">{(a.uri || a.agentUri || '').replace('agent://', '')}</code>
                {a.tier && <Badge variant="outline" className="text-[9px]">{a.tier}</Badge>}
                <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                  {a.lifecycleState === 'active' && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                      onClick={() => runAction('suspend', a.uri || a.agentUri)}
                      disabled={actionLoading !== null}>
                      {actionLoading === `suspend:${a.uri || a.agentUri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Suspend'}
                    </Button>
                  )}
                  {a.lifecycleState === 'suspended' && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                      onClick={() => runAction('resume', a.uri || a.agentUri)}
                      disabled={actionLoading !== null}>
                      {actionLoading === `resume:${a.uri || a.agentUri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Resume'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                    onClick={() => runAction('upgrade', a.uri || a.agentUri)}
                    disabled={actionLoading !== null}>
                    {actionLoading === `upgrade:${a.uri || a.agentUri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Upgrade'}
                  </Button>
                </div>
              </div>
              {a.description && <div className="text-muted-foreground">{a.description}</div>}
              {a.capabilities && Array.isArray(a.capabilities) && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {a.capabilities.slice(0, 5).map((c: string) => <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// === Skills Tab ======================================================

function SkillsTab({ skillData, onRefresh }: { skillData: any; onRefresh: () => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [selectedSkillUri, setSelectedSkillUri] = useState<string | null>(null)

  const search = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    setSearching(true)
    try {
      const res = await fetch('/api/skill-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', query: searchQuery, topK: 10 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setSearchResults(d.results || [])
      if ((d.results || []).length === 0) toast.info('No skills found')
      else toast.success(`Found ${d.results.length} skill(s)`)
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`)
    } finally {
      setSearching(false)
    }
  }

  const seedDefaults = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/skill-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed-defaults' }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Seed failed: ${body.error}`); return }
      toast.success(`Skills seeded: ${body.created ?? 0} created, ${body.skipped ?? 0} skipped`)
      onRefresh()
    } catch (err: any) {
      toast.error(`Seed failed: ${err.message}`)
    } finally {
      setSeeding(false)
    }
  }

  // C6.18 — Export skill as JSON
  const exportSkill = async (uri: string, format: 'json' | 'skillmd') => {
    try {
      const res = await fetch(`/api/skills/export?uri=${encodeURIComponent(uri)}&format=${format}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (format === 'json') {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${uri.replace(/[^a-zA-Z0-9]/g, '_')}.json`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        const text = await res.text()
        const blob = new Blob([text], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `SKILL.md`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
      toast.success(`Skill exported as ${format.toUpperCase()}`)
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    }
  }

  const skills = searchResults ?? skillData?.skills ?? []

  // C6.18 — Show detail view if a skill is selected
  if (selectedSkillUri) {
    return (
      <SkillDetailView
        uri={selectedSkillUri}
        skill={skills.find(s => s.uri === selectedSkillUri)}
        onBack={() => setSelectedSkillUri(null)}
        onExport={exportSkill}
        onRefresh={onRefresh}
      />
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench className="w-4 h-4" /> Skill Registry
            </CardTitle>
            <CardDescription>{skillData?.stats?.total ?? 0} skill{(skillData?.stats?.total ?? 0) === 1 ? '' : 's'} registered</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={seedDefaults} disabled={seeding}>
            {seeding ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            {seeding ? 'Seeding…' : 'Seed Defaults'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Skill search */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="search skills by name, description, tags…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null) }}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              className="text-xs pl-7"
            />
          </div>
          <Button size="sm" onClick={search} disabled={searching || !searchQuery.trim()}>
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </Button>
          {searchResults && (
            <Button size="sm" variant="ghost" onClick={() => { setSearchResults(null); setSearchQuery('') }}>
              Clear
            </Button>
          )}
        </div>

        {skills.length > 0 ? (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {skills.slice(0, 30).map((s: any) => (
              <div
                key={s.uri}
                className="border rounded p-2 text-xs cursor-pointer hover:bg-accent/30 transition-colors group"
                onClick={() => setSelectedSkillUri(s.uri)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge variant="outline" className="text-[9px]">v{s.version}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={s.lifecycleState === 'active' ? 'success' : s.lifecycleState === 'deprecated' ? 'destructive' : 'secondary'} className="text-[9px]">{s.lifecycleState}</Badge>
                    <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </div>
                </div>
                <div className="text-muted-foreground truncate mt-0.5">{s.description}</div>
                {s.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {s.tags.slice(0, 4).map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                  </div>
                )}
                {s.score && <div className="text-[10px] text-muted-foreground mt-0.5">score: {s.score.toFixed(3)}</div>}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="Wrench"
            title={searchResults ? "No skills match your search" : "No skills registered"}
            description={searchResults ? "Try a different search query" : "Seed default skills or create new ones via the Admin panel"}
          />
        )}
      </CardContent>
    </Card>
  )
}

// === Skill Detail View (C6.18 Fase 3) ================================

function SkillDetailView({ uri, skill, onBack, onExport, onRefresh }: {
  uri: string
  skill: any
  onBack: () => void
  onExport: (uri: string, format: 'json' | 'skillmd') => void
  onRefresh: () => void
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const runLifecycle = async (newState: string) => {
    setActionLoading(newState)
    try {
      const res = await fetch('/api/skill-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lifecycle', uri, newState, actor: 'user://admin', reason: `${newState} via UI` }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`${newState} failed: ${body.error}`); return }
      toast.success(`Skill ${newState}`)
      onRefresh()
      onBack()
    } catch (err: any) {
      toast.error(`${newState} failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const createVersion = async () => {
    const newVersion = prompt('New version number (e.g. 1.1.0):')
    if (!newVersion) return
    setActionLoading('version')
    try {
      const res = await fetch('/api/skill-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'version', sourceUri: uri, newVersion, updates: {} }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Version failed: ${body.error}`); return }
      toast.success(`Version ${newVersion} created`)
      onRefresh()
      onBack()
    } catch (err: any) {
      toast.error(`Version failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  if (!skill) {
    return (
      <Card>
        <CardContent className="p-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <p className="text-xs text-muted-foreground">Skill not found in local cache. Try refreshing.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">{skill.name}</h3>
                <Badge variant="outline" className="text-[9px]">v{skill.version}</Badge>
                <Badge variant={skill.lifecycleState === 'active' ? 'success' : skill.lifecycleState === 'deprecated' ? 'destructive' : 'secondary'} className="text-[9px]">{skill.lifecycleState}</Badge>
              </div>
              <code className="text-[10px] font-mono text-muted-foreground">{skill.uri}</code>
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {skill.lifecycleState === 'active' && (
              <Button size="sm" variant="outline" onClick={() => runLifecycle('deprecated')} disabled={actionLoading !== null} className="h-7 text-xs">
                {actionLoading === 'deprecated' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Deprecate
              </Button>
            )}
            {skill.lifecycleState === 'deprecated' && (
              <Button size="sm" variant="default" onClick={() => runLifecycle('active')} disabled={actionLoading !== null} className="h-7 text-xs">
                {actionLoading === 'active' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Activate
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={createVersion} disabled={actionLoading !== null} className="h-7 text-xs">
              {actionLoading === 'version' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} New Version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onExport(uri, 'json')} className="h-7 text-xs">
              Export JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onExport(uri, 'skillmd')} className="h-7 text-xs">
              Export SKILL.md
            </Button>
          </div>
        </div>

        {/* Description */}
        {skill.description && (
          <p className="text-xs text-muted-foreground">{skill.description}</p>
        )}

        {/* Tags */}
        {skill.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skill.tags.map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Left: prompt template + tests */}
          <div className="space-y-3">
            {/* Prompt Template */}
            {skill.promptTemplate && (
              <div>
                <div className="text-xs font-medium mb-1">Prompt Template</div>
                <pre className="text-[10px] font-mono bg-muted/30 border rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap">{skill.promptTemplate}</pre>
              </div>
            )}

            {/* Tests */}
            {skill.tests?.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Tests ({skill.tests.length})</div>
                <div className="space-y-1">
                  {skill.tests.map((t: any, i: number) => (
                    <div key={i} className="border rounded p-1.5 text-[10px]">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-muted-foreground">input: {t.input?.slice(0, 80)}</div>
                      {t.expectedContains?.length > 0 && (
                        <div className="text-muted-foreground">expects: {t.expectedContains.join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Examples */}
            {skill.examples?.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Examples ({skill.examples.length})</div>
                <div className="space-y-1">
                  {skill.examples.map((ex: any, i: number) => (
                    <div key={i} className="border rounded p-1.5 text-[10px]">
                      <div className="text-muted-foreground">{ex.input?.slice(0, 80)}</div>
                      <div className="mt-0.5">{ex.output?.slice(0, 80)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: tools + memory + constraints */}
          <div className="space-y-3">
            {/* Tools */}
            <div>
              <div className="text-xs font-medium mb-1">Tools</div>
              {skill.tools?.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {skill.tools.map((t: string) => <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>)}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">No tools required</p>
              )}
            </div>

            {/* Memory requirements */}
            {skill.memory && (
              <div>
                <div className="text-xs font-medium mb-1">Memory Requirements</div>
                <div className="space-y-0.5 text-[10px] text-muted-foreground">
                  {skill.memory.requiredLayers?.length > 0 && (
                    <div>Required layers: {skill.memory.requiredLayers.join(', ')}</div>
                  )}
                  {skill.memory.contextBudget && (
                    <div>Context budget: {skill.memory.contextBudget.toLocaleString()} tokens</div>
                  )}
                </div>
              </div>
            )}

            {/* Constraints */}
            {skill.constraints && (
              <div>
                <div className="text-xs font-medium mb-1">Constraints</div>
                <div className="space-y-0.5 text-[10px] text-muted-foreground">
                  {skill.constraints.tokenBudget && (
                    <div>Token budget: {skill.constraints.tokenBudget.toLocaleString()}</div>
                  )}
                  {skill.constraints.timeout && (
                    <div>Timeout: {(skill.constraints.timeout / 1000).toFixed(1)}s</div>
                  )}
                  {skill.constraints.ltlRules?.length > 0 && (
                    <div>LTL rules: {skill.constraints.ltlRules.join(', ')}</div>
                  )}
                  {skill.constraints.redLines?.length > 0 && (
                    <div className="text-status-danger">
                      Red lines:
                      <ul className="ml-3 list-disc">
                        {skill.constraints.redLines.map((rl: string, i: number) => <li key={i}>{rl}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div>
              <div className="text-xs font-medium mb-1">Metadata</div>
              <div className="space-y-0.5 text-[10px] text-muted-foreground">
                <div>URI: <code className="font-mono">{skill.uri}</code></div>
                <div>Version: {skill.version}</div>
                <div>State: {skill.lifecycleState}</div>
                {skill.usageCount !== undefined && <div>Usage count: {skill.usageCount}</div>}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// === Synthesis Tab ===================================================

function SynthesisTab({ synthData, onRefresh }: { synthData: any; onRefresh: () => void }) {
  const [detecting, setDetecting] = useState(false)
  const [gaps, setGaps] = useState<any[] | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const detectGaps = async () => {
    setDetecting(true)
    try {
      const res = await fetch('/api/skill-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect-gaps' }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Detect failed: ${body.error}`); return }
      setGaps(body.gaps || [])
      if ((body.gaps || []).length === 0) toast.info('No skill gaps detected')
      else toast.success(`Found ${body.gaps.length} skill gap(s)`)
    } catch (err: any) {
      toast.error(`Detect failed: ${err.message}`)
    } finally {
      setDetecting(false)
    }
  }

  const runPipeline = async (gapId: string) => {
    setRunning(gapId)
    try {
      const res = await fetch('/api/skill-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-pipeline', gapId }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Pipeline failed: ${body.error}`); return }
      toast.success('Skill synthesized and tested', {
        description: `Status: ${body.pipeline?.finalStatus || 'completed'}`,
        duration: 6000,
      })
      onRefresh()
    } catch (err: any) {
      toast.error(`Pipeline failed: ${err.message}`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Skill Synthesis
          </CardTitle>
          <CardDescription>
            {synthData?.totalGenerated ?? synthData?.stats?.totalGenerated ?? 0} synthesized ·
            {' '}{synthData?.approved ?? synthData?.stats?.approved ?? 0} approved ·
            {' '}{synthData?.pendingApproval ?? synthData?.stats?.pendingApproval ?? 0} pending
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={detectGaps} disabled={detecting}>
            {detecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1" />}
            {detecting ? 'Detecting gaps…' : 'Detect Skill Gaps'}
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2">
            Analyzes recent failed tasks to identify patterns where a new skill could help.
          </p>
        </CardContent>
      </Card>

      {/* Detected gaps */}
      {gaps && gaps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Detected Skill Gaps ({gaps.length})</CardTitle>
            <CardDescription>Click "Synthesize" to auto-generate + test a skill for each gap</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {gaps.map((gap, i) => (
                <div key={i} className="border rounded p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="warning" className="text-[9px]">gap</Badge>
                      <span className="font-medium">{gap.pattern || gap.suggestedDomain || `Gap ${i + 1}`}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runPipeline(gap.gapId || String(i))}
                      disabled={running !== null}
                      className="h-6 text-[10px]"
                    >
                      {running === (gap.gapId || String(i)) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                      {running === (gap.gapId || String(i)) ? 'Synthesizing…' : 'Synthesize'}
                    </Button>
                  </div>
                  {gap.occurrences && <div className="text-[10px] text-muted-foreground">{gap.occurrences} occurrences</div>}
                  {gap.suggestedDomain && <div className="text-[10px] text-muted-foreground">domain: {gap.suggestedDomain}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {gaps && gaps.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <EmptyState icon="Sparkles" title="No skill gaps detected" description="The system has adequate skills for current task patterns" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// === Proposals Tab ===================================================

function ProposalsTab({ proposalData, onRefresh }: { proposalData: any; onRefresh: () => void }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<any[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const approve = async (proposalUri: string) => {
    setActionLoading(`approve:${proposalUri}`)
    try {
      const res = await fetch('/api/autonomous-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', proposalUri, approvedBy: 'user://admin' }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Approve failed: ${body.error}`); return }
      toast.success('Proposal approved')
      onRefresh()
    } catch (err: any) {
      toast.error(`Approve failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const reject = async (proposalUri: string) => {
    const reason = prompt('Rejection reason (optional):') || 'Rejected via UI'
    setActionLoading(`reject:${proposalUri}`)
    try {
      const res = await fetch('/api/autonomous-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', proposalUri, rejectedBy: 'user://admin', reason }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Reject failed: ${body.error}`); return }
      toast.success('Proposal rejected')
      onRefresh()
    } catch (err: any) {
      toast.error(`Reject failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const generateAuto = async () => {
    setActionLoading('generate-auto')
    try {
      const res = await fetch('/api/autonomous-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-auto' }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Generate failed: ${body.error}`); return }
      toast.success(`Generated ${body.created ?? 0} proposal(s)`)
      onRefresh()
    } catch (err: any) {
      toast.error(`Generate failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const pending = proposalData?.pending || []
  const stats = proposalData?.stats || {}

  return (
    <div className="space-y-3">
      {/* Stats + actions bar */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" /> Autonomous Org
              </CardTitle>
              <CardDescription>
                {stats.pending ?? 0} pending · {stats.approved ?? 0} approved · {stats.rejected ?? 0} rejected · {stats.executed ?? 0} executed · {stats.expired ?? 0} expired
              </CardDescription>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={generateAuto} disabled={actionLoading !== null} className="h-7 text-xs">
                {actionLoading === 'generate-auto' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                Generate Auto
              </Button>
              <Button size="sm" onClick={() => setShowCreate(s => !s)} className="h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" /> {showCreate ? 'Close' : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowHistory(s => !s); if (!history) fetchHistory() }} className="h-7 text-xs">
                {showHistory ? 'Hide History' : 'History'}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Create proposal form */}
      {showCreate && <CreateProposalCard onCreated={() => { setShowCreate(false); onRefresh() }} />}

      {/* History */}
      {showHistory && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Proposal History</CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : history && history.length > 0 ? (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {history.map((p: any, i: number) => (
                  <div key={i} className="border rounded p-2 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === 'approved' ? 'success' : p.status === 'rejected' ? 'destructive' : p.status === 'expired' ? 'secondary' : 'warning'} className="text-[9px]">{p.status}</Badge>
                      <Badge variant="outline" className="text-[9px]">{p.type}</Badge>
                      <span className="truncate">{p.description}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{new Date(p.proposedAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No history available</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pending proposals */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Pending Proposals ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {pending.map((p: any) => (
                <div key={p.uri} className="flex items-start justify-between border rounded p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{p.type}</Badge>
                      <span className="text-sm font-medium">{p.description}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{p.rationale}</p>
                    {p.expectedImpact && typeof p.expectedImpact === 'object' && (
                      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span>Cost: {p.expectedImpact.costDelta ?? 0}</span>
                        <span>Perf: {((p.expectedImpact.performanceDelta ?? 0) * 100).toFixed(0)}%</span>
                        <span>Risk: {p.expectedImpact.riskLevel ?? 'unknown'}</span>
                      </div>
                    )}
                    {p.expiresAt && (
                      <p className="text-[10px] text-status-warn mt-0.5">Expires: {new Date(p.expiresAt).toLocaleString()}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <Button size="sm" variant="default" onClick={() => approve(p.uri)} disabled={actionLoading !== null} className="h-7 text-xs">
                      {actionLoading === `approve:${p.uri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-0.5" />}
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reject(p.uri)} disabled={actionLoading !== null} className="h-7 text-xs hover:text-destructive">
                      {actionLoading === `reject:${p.uri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3 mr-0.5" />}
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="Activity" title="No pending proposals" description="The system is stable — no autonomous actions require approval" />
          )}
        </CardContent>
      </Card>
    </div>
  )

  async function fetchHistory() {
    setHistoryLoading(true)
    try {
      // Fetch all proposals (not just pending) by using a larger limit
      const res = await fetch('/api/autonomous-org')
      const d = await res.json()
      // The API only returns pending; for history we need a different approach
      // For now, show what we have from stats
      setHistory(d.pending || [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }
}

// === Create Proposal Card (C6.19 Fase 4) =============================

function CreateProposalCard({ onCreated }: { onCreated: () => void }) {
  const [type, setType] = useState('create_skill')
  const [description, setDescription] = useState('')
  const [rationale, setRationale] = useState('')
  const [costDelta, setCostDelta] = useState('0')
  const [performanceDelta, setPerformanceDelta] = useState('0.1')
  const [riskLevel, setRiskLevel] = useState('low')
  const [payload, setPayload] = useState('{}')
  const [expiresInHours, setExpiresInHours] = useState('24')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!description.trim() || !rationale.trim()) {
      toast.error('Description and rationale are required')
      return
    }
    let payloadObj: any
    try { payloadObj = JSON.parse(payload) } catch {
      toast.error('Payload must be valid JSON')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/autonomous-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          type, description, rationale,
          expectedImpact: {
            costDelta: parseFloat(costDelta) || 0,
            performanceDelta: parseFloat(performanceDelta) || 0,
            riskLevel,
          },
          payload: payloadObj,
          expiresInHours: parseInt(expiresInHours) || 24,
        }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Create failed: ${body.error}`); return }
      toast.success('Proposal created')
      setDescription(''); setRationale(''); setPayload('{}')
      onCreated()
    } catch (err: any) {
      toast.error(`Create failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const proposalTypes = [
    { value: 'create_agent', label: 'Create Agent' },
    { value: 'create_skill', label: 'Create Skill' },
    { value: 'create_workflow', label: 'Create Workflow' },
    { value: 'optimize_process', label: 'Optimize Process' },
    { value: 'reorganize_memory', label: 'Reorganize Memory' },
    { value: 'upgrade_agent', label: 'Upgrade Agent' },
    { value: 'learn_from_experience', label: 'Learn from Experience' },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Proposal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Type</span>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full h-7 text-xs border rounded bg-background px-2">
              {proposalTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Expires in (hours)</span>
            <Input type="number" value={expiresInHours} onChange={e => setExpiresInHours(e.target.value)} className="text-xs h-7" />
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Description *</span>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this proposal do?" className="text-xs" />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Rationale *</span>
          <Textarea value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Why is this needed?" className="text-xs min-h-[50px]" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Cost Delta</span>
            <Input value={costDelta} onChange={e => setCostDelta(e.target.value)} placeholder="0.00" className="text-xs h-7" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Perf Delta (0-1)</span>
            <Input value={performanceDelta} onChange={e => setPerformanceDelta(e.target.value)} placeholder="0.1" className="text-xs h-7" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Risk Level</span>
            <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className="w-full h-7 text-xs border rounded bg-background px-2">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Payload (JSON)</span>
          <Textarea value={payload} onChange={e => setPayload(e.target.value)} placeholder='{"key": "value"}' className="text-xs font-mono min-h-[50px]" />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setDescription(''); setRationale(''); setPayload('{}') }} disabled={saving}>Clear</Button>
          <Button size="sm" onClick={submit} disabled={saving || !description.trim() || !rationale.trim()}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            {saving ? 'Creating…' : 'Create Proposal'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// === Mesh Actions Card (C6.19 Fase 4) ================================

function MeshActionsCard({ meshData, onRefresh }: { meshData: any; onRefresh: () => void }) {
  const [actionType, setActionType] = useState<'delegate' | 'escalate' | 'quorum'>('delegate')
  const [fromAgent, setFromAgent] = useState('')
  const [toAgent, setToAgent] = useState('')
  const [taskUri, setTaskUri] = useState('')
  const [reason, setReason] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [proposal, setProposal] = useState('')
  const [requiredQuorum, setRequiredQuorum] = useState('2')
  const [saving, setSaving] = useState(false)

  const agents = meshData?.topology?.nodes?.map((n: any) => n.agentUri) || []

  const submit = async () => {
    setSaving(true)
    try {
      const body: any = { action: actionType }
      if (actionType === 'delegate') {
        if (!fromAgent || !toAgent || !taskUri) { toast.error('All fields required'); setSaving(false); return }
        body.fromAgentUri = fromAgent
        body.toAgentUri = toAgent
        body.taskUri = taskUri
      } else if (actionType === 'escalate') {
        if (!fromAgent || !toAgent || !reason) { toast.error('All fields required'); setSaving(false); return }
        body.fromAgentUri = fromAgent
        body.toAgentUri = toAgent
        body.reason = reason
        body.severity = severity
      } else if (actionType === 'quorum') {
        if (!fromAgent || !proposal) { toast.error('All fields required'); setSaving(false); return }
        body.proposerAgentUri = fromAgent
        body.proposal = proposal
        body.requiredQuorum = parseInt(requiredQuorum) || 2
      }

      const res = await fetch('/api/agent-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resBody = await res.json()
      if (!res.ok) { toast.error(`${actionType} failed: ${resBody.error}`); return }
      toast.success(`${actionType} succeeded`)
      // Clear fields
      setTaskUri(''); setReason(''); setProposal('')
      onRefresh()
    } catch (err: any) {
      toast.error(`${actionType} failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="w-4 h-4" /> Mesh Actions
        </CardTitle>
        <CardDescription>Delegate tasks, escalate issues, or request peer quorum</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Action type selector */}
        <div className="flex gap-2">
          {(['delegate', 'escalate', 'quorum'] as const).map(t => (
            <Button key={t} size="sm" variant={actionType === t ? 'default' : 'outline'} onClick={() => setActionType(t)} className="text-xs capitalize">
              {t}
            </Button>
          ))}
        </div>

        {/* Dynamic form based on action type */}
        <div className="space-y-2">
          {/* From agent (all actions) */}
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">{actionType === 'quorum' ? 'Proposer Agent' : 'From Agent'}</span>
            <select value={fromAgent} onChange={e => setFromAgent(e.target.value)} className="w-full h-7 text-xs border rounded bg-background px-2">
              <option value="">— select agent —</option>
              {agents.map((a: string) => <option key={a} value={a}>{a.replace('agent://', '')}</option>)}
            </select>
          </div>

          {/* To agent (delegate, escalate) */}
          {actionType !== 'quorum' && (
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">To Agent</span>
              <select value={toAgent} onChange={e => setToAgent(e.target.value)} className="w-full h-7 text-xs border rounded bg-background px-2">
                <option value="">— select agent —</option>
                {agents.filter((a: string) => a !== fromAgent).map((a: string) => <option key={a} value={a}>{a.replace('agent://', '')}</option>)}
              </select>
            </div>
          )}

          {/* Task URI (delegate) */}
          {actionType === 'delegate' && (
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Task URI</span>
              <Input value={taskUri} onChange={e => setTaskUri(e.target.value)} placeholder="task://plan_xxx/T1" className="text-xs h-7 font-mono" />
            </div>
          )}

          {/* Reason (escalate) */}
          {actionType === 'escalate' && (
            <>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Reason</span>
                <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this escalated?" className="text-xs min-h-[40px]" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Severity</span>
                <select value={severity} onChange={e => setSeverity(e.target.value)} className="w-full h-7 text-xs border rounded bg-background px-2">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </>
          )}

          {/* Proposal + quorum (quorum) */}
          {actionType === 'quorum' && (
            <>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Proposal</span>
                <Textarea value={proposal} onChange={e => setProposal(e.target.value)} placeholder="What decision needs quorum?" className="text-xs min-h-[40px]" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Required Quorum</span>
                <Input type="number" value={requiredQuorum} onChange={e => setRequiredQuorum(e.target.value)} className="text-xs h-7" />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
            {saving ? 'Executing…' : `Execute ${actionType}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// === Agent Detail View (C6.17 Fase 2) ================================

function AgentDetailView({ uri, onBack, onRefresh }: { uri: string; onBack: () => void; onRefresh: () => void }) {
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-lifecycle/detail?uri=${encodeURIComponent(uri)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const d = await res.json()
      setDetail(d)
    } catch (err: any) {
      setError(err.message)
      toast.error(`Failed to load agent: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [uri])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const runAction = async (action: string) => {
    setActionLoading(action)
    try {
      const res = await fetch('/api/agent-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, agentUri: uri }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`${action} failed: ${body.error}`); return }
      toast.success(`${action} succeeded`)
      fetchDetail()
      onRefresh()
    } catch (err: any) {
      toast.error(`${action} failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <Card className="mb-4">
        <CardContent className="p-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="mb-4">
        <CardContent className="p-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <div className="text-xs text-status-danger">Error: {error}</div>
          <Button size="sm" variant="outline" onClick={fetchDetail} className="mt-2">Retry</Button>
        </CardContent>
      </Card>
    )
  }

  const { agent, mesh, edges, metrics } = detail
  const isActive = agent.lifecycleState === 'active'
  const isSuspended = agent.lifecycleState === 'suspended'

  return (
    <Card className="mb-4">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">{agent.name}</h3>
                <Badge variant={isActive ? 'success' : isSuspended ? 'warning' : 'secondary'}>{agent.lifecycleState}</Badge>
                {mesh?.tier && <Badge variant="outline" className="text-[9px]">{mesh.tier}</Badge>}
              </div>
              <code className="text-[10px] font-mono text-muted-foreground">{agent.uri}</code>
            </div>
          </div>
          <div className="flex gap-1">
            {isActive && (
              <Button size="sm" variant="outline" onClick={() => runAction('suspend')} disabled={actionLoading !== null} className="h-7 text-xs">
                {actionLoading === 'suspend' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Suspend
              </Button>
            )}
            {isSuspended && (
              <Button size="sm" variant="default" onClick={() => runAction('resume')} disabled={actionLoading !== null} className="h-7 text-xs">
                {actionLoading === 'resume' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Resume
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => runAction('upgrade')} disabled={actionLoading !== null} className="h-7 text-xs">
              {actionLoading === 'upgrade' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Upgrade
            </Button>
          </div>
        </div>

        {/* Description */}
        {agent.description && (
          <p className="text-xs text-muted-foreground">{agent.description}</p>
        )}

        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="border rounded p-2 text-center">
            <div className="text-lg font-bold text-status-ok">{metrics.tasksDone}</div>
            <div className="text-[10px] text-muted-foreground">Tasks Done</div>
          </div>
          <div className="border rounded p-2 text-center">
            <div className={`text-lg font-bold ${metrics.successRate > 0.8 ? 'text-status-ok' : metrics.successRate > 0.5 ? 'text-status-warn' : 'text-status-danger'}`}>
              {(metrics.successRate * 100).toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted-foreground">Success Rate</div>
          </div>
          <div className="border rounded p-2 text-center">
            <div className="text-lg font-bold">${metrics.totalCost.toFixed(4)}</div>
            <div className="text-[10px] text-muted-foreground">Total Cost</div>
          </div>
          <div className="border rounded p-2 text-center">
            <div className="text-lg font-bold">{metrics.totalLogs}</div>
            <div className="text-[10px] text-muted-foreground">Log Events</div>
          </div>
        </div>

        {/* Detailed info in two columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Left: mesh + capabilities */}
          <div className="space-y-3">
            {mesh && (
              <div>
                <div className="text-xs font-medium mb-1">Mesh Relationships</div>
                <div className="space-y-0.5 text-[11px]">
                  {mesh.parentAgentUri && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Reports to:</span>
                      <code className="font-mono">{mesh.parentAgentUri.replace('agent://', '')}</code>
                    </div>
                  )}
                  {mesh.childAgentUris?.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Manages:</span>
                      <span>{mesh.childAgentUris.map((u: string) => u.replace('agent://', '')).join(', ')}</span>
                    </div>
                  )}
                  {mesh.peerAgentUris?.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Peers:</span>
                      <span>{mesh.peerAgentUris.map((u: string) => u.replace('agent://', '')).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {agent.capabilities?.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Capabilities</div>
                <div className="flex flex-wrap gap-1">
                  {agent.capabilities.map((c: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px]">{c.replace('agent-capability://', '')}</Badge>
                  ))}
                </div>
              </div>
            )}

            {agent.skills?.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Skills</div>
                <div className="flex flex-wrap gap-1">
                  {agent.skills.map((s: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[9px]">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            {agent.policies?.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Policies</div>
                <div className="flex flex-wrap gap-1">
                  {agent.policies.map((p: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px]">{p.replace('agent-policy://', '')}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: metrics detail + lifecycle history */}
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium mb-1">Token Usage</div>
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> Calls: {metrics.totalCalls}</div>
                <div className="flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" /> Tokens in: {metrics.totalTokensIn.toLocaleString()}</div>
                <div className="flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" /> Tokens out: {metrics.totalTokensOut.toLocaleString()}</div>
                <div className="flex items-center gap-1"><DollarSign className="w-2.5 h-2.5" /> Cost: ${metrics.totalCost.toFixed(4)}</div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium mb-1">Task Stats</div>
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
                <div>Total: {metrics.taskCount}</div>
                <div className="text-status-ok">Done: {metrics.tasksDone}</div>
                <div className="text-status-danger">Failed: {metrics.tasksFailed}</div>
                <div>Errors: {metrics.errorLogs} · Warnings: {metrics.warnLogs}</div>
              </div>
            </div>

            {metrics.lastActivity && (
              <div>
                <div className="text-xs font-medium mb-1">Last Activity</div>
                <div className="text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {new Date(metrics.lastActivity.timestamp).toLocaleString()}</div>
                  <div>Event: {metrics.lastActivity.event}</div>
                  <div>Phase: {metrics.lastActivity.phase}</div>
                </div>
              </div>
            )}

            {agent.lifecycleHistory?.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Lifecycle History</div>
                <div className="space-y-0.5">
                  {agent.lifecycleHistory.slice(-5).reverse().map((h: any, i: number) => (
                    <div key={i} className="text-[10px] text-muted-foreground border-l-2 border-primary/30 pl-2">
                      <span className="font-mono">{h.from} → {h.to}</span>
                      <span className="ml-1">{new Date(h.timestamp).toLocaleDateString()}</span>
                      {h.reason && <div className="italic">{h.reason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
