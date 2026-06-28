'use client'

/**
 * Agents Org View — C6.16 Fase 1
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Wrench, GitBranch, Activity, Search, Loader2, Plus, Check, X, RefreshCw, Network, Sparkles } from 'lucide-react'

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
          <MeshTab meshData={meshData} onBootstrap={bootstrap} bootstrapping={bootstrapping} />
        </TabsContent>

        {/* === LIFECYCLE TAB === */}
        <TabsContent value="lifecycle" className="mt-4">
          <LifecycleTab lifecycleData={lifecycleData} onRefresh={fetchData} />
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

function MeshTab({ meshData, onBootstrap, bootstrapping }: { meshData: any; onBootstrap: () => void; bootstrapping: boolean }) {
  const tiers = ['executive', 'strategic', 'operational', 'specialized'] as const

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Network className="w-4 h-4" /> Agent Mesh Topology
        </CardTitle>
        <CardDescription>
          {meshData.stats?.totalAgents ?? 0} agents · {meshData.stats?.totalEdges ?? 0} edges ·
          {' '}{meshData.stats?.executiveAgents ?? 0} executive · {meshData.stats?.strategicAgents ?? 0} strategic ·
          {' '}{meshData.stats?.operationalAgents ?? 0} operational · {meshData.stats?.specializedAgents ?? 0} specialized
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
                  <span className="size-1.5 rounded-full" style={{
                    background: tier === 'executive' ? 'var(--status-ok)' : tier === 'strategic' ? 'var(--status-warn)' : tier === 'operational' ? 'var(--status-info)' : 'var(--muted-foreground)'
                  }} />
                  {tier} ({agents.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {agents.map((a: any) => (
                    <Badge key={a.agentUri} variant="outline" className="text-xs">
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
  )
}

// === Lifecycle Tab ===================================================

function LifecycleTab({ lifecycleData, onRefresh }: { lifecycleData: any; onRefresh: () => void }) {
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
            <div key={a.uri || a.agentUri} className="border rounded p-2 text-xs group">
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

  const skills = searchResults ?? skillData?.skills ?? []

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
        {/* C6.16 — Skill search */}
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
          <div className="space-y-1 max-h-64 overflow-auto">
            {skills.slice(0, 20).map((s: any) => (
              <div key={s.uri} className="border rounded p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant={s.lifecycleState === 'active' ? 'success' : 'secondary'} className="text-[9px]">{s.lifecycleState}</Badge>
                </div>
                <div className="text-muted-foreground truncate mt-0.5">{s.description}</div>
                {s.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {s.tags.slice(0, 3).map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
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

  const pending = proposalData?.pending || []

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4" /> Autonomous Org — Pending Proposals
        </CardTitle>
        <CardDescription>
          {proposalData?.stats?.pending ?? 0} pending · {proposalData?.stats?.approved ?? 0} approved ·
          {' '}{proposalData?.stats?.rejected ?? 0} rejected · {proposalData?.stats?.executed ?? 0} executed
        </CardDescription>
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
                  {p.expectedImpact && <p className="text-[10px] text-muted-foreground/70 mt-0.5">Impact: {p.expectedImpact}</p>}
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => approve(p.uri)}
                    disabled={actionLoading !== null}
                    className="h-7 text-xs"
                  >
                    {actionLoading === `approve:${p.uri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-0.5" />}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reject(p.uri)}
                    disabled={actionLoading !== null}
                    className="h-7 text-xs hover:text-destructive"
                  >
                    {actionLoading === `reject:${p.uri}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3 mr-0.5" />}
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="Activity"
            title="No pending proposals"
            description="The system is stable — no autonomous actions require approval"
          />
        )}
      </CardContent>
    </Card>
  )
}
