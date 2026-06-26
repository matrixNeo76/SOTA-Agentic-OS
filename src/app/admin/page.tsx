'use client'

/**
 * Admin Panel — WS2.1
 *
 * Pannello admin completo con 6 tab:
 *   1. Settings — configurazione sistema (DB, LLM, Event Mesh, Langfuse, tool paths)
 *   2. Runtime — stato worker, piani running, recovery, GC
 *   3. Tools — builtin + registrati + MCP esterni, test tool, registra nuovo
 *   4. Governance — RedLines, NormativeRules, ApprovalGates, BlockedActions, LTL
 *   5. Memory — Context Graph browser + semantic search + GC stats
 *   6. Users — gestione utenti, ruoli, sessioni
 *
 * Tutte le API routes sono role-gated (requireAdmin: admin + operator only).
 */

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RefreshCw, Settings, Activity, Wrench, Shield, Database, Users, Play, AlertTriangle, Check, X, Save, RotateCcw, Lock } from 'lucide-react'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('settings')

  return (
    <main className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">
          WS2 — System configuration, runtime control, governance, and user management
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-6 mb-4">
          <TabsTrigger value="settings" className="flex items-center gap-1">
            <Settings className="w-4 h-4" /> Settings
          </TabsTrigger>
          <TabsTrigger value="runtime" className="flex items-center gap-1">
            <Activity className="w-4 h-4" /> Runtime
          </TabsTrigger>
          <TabsTrigger value="tools" className="flex items-center gap-1">
            <Wrench className="w-4 h-4" /> Tools
          </TabsTrigger>
          <TabsTrigger value="governance" className="flex items-center gap-1">
            <Shield className="w-4 h-4" /> Governance
          </TabsTrigger>
          <TabsTrigger value="memory" className="flex items-center gap-1">
            <Database className="w-4 h-4" /> Memory
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-1">
            <Users className="w-4 h-4" /> Users
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings"><SettingsTab /></TabsContent>
        <TabsContent value="runtime"><RuntimeTab /></TabsContent>
        <TabsContent value="tools"><ToolsTab /></TabsContent>
        <TabsContent value="governance"><GovernanceTab /></TabsContent>
        <TabsContent value="memory"><MemoryTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
      </Tabs>
    </main>
  )
}

// === Shared helpers =================================================

function useAdminData<T>(endpoint: string): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/${endpoint}`)
      if (res.status === 401) { setError('Not authenticated'); return }
      if (res.status === 403) { setError('Insufficient permissions (admin/operator required)'); return }
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      setData(await res.json())
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { fetchData() }, [fetchData])
  return { data, loading, error, refresh: fetchData }
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" size="sm" onClick={onClick}><RefreshCw className="w-4 h-4 mr-1" /> Refresh</Button>
}

function StatBox({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'danger' }) {
  const colorClass = tone === 'ok' ? 'text-green-600' : tone === 'warn' ? 'text-yellow-600' : tone === 'danger' ? 'text-red-600' : ''
  return (
    <div className="border rounded p-3 text-center">
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  )
}

// === 1. Settings Tab =================================================

// === Types for the new C6 settings response ===========================

interface SettingValue {
  key: string
  value: string
  category: string
  readOnly: boolean
  description: string
  source: 'db' | 'env' | 'default'
  updatedAt?: string
  updatedBy?: string | null
}

interface LiveStatus {
  database: { provider: string; url: string; extensions: { pgvector: boolean; age: boolean } }
  llm: { available: boolean; model: string; latencyMs?: number; apiKeyConfigured: boolean }
  embedding: { provider: string; model?: string; available?: boolean }
  eventMesh: { backend: string; healthy: boolean; details?: { subscribers?: number } }
  observability: { langfuseEnabled: boolean; langfuseUrl: string | null }
  integration: { started: boolean; activeSubscriptions: number }
  toolPaths: { read: string[]; write: string[] }
  mcpExternalServers: string | null
}

interface SettingsResponse {
  settings: SettingValue[]
  byCategory: Record<string, SettingValue[]>
  live: LiveStatus
  schemaVersion: number
}

// === 1. Settings Tab =================================================

function SettingsTab() {
  const { data, loading, error, refresh } = useAdminData<SettingsResponse>('settings')
  const [reloadLoading, setReloadLoading] = useState(false)

  const handleReload = async () => {
    setReloadLoading(true)
    try {
      const res = await fetch('/api/admin/settings/reload', { method: 'POST' })
      if (!res.ok) {
        toast.error(`Reload failed: HTTP ${res.status}`)
        return
      }
      const body = await res.json()
      toast.success(`Cache reloaded in ${body.durationMs}ms`)
      refresh()
    } catch (err: any) {
      toast.error(`Reload failed: ${err.message}`)
    } finally {
      setReloadLoading(false)
    }
  }

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (error) return <Card><CardContent className="p-4 text-destructive">{error}</CardContent></Card>
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">System Configuration</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Writable settings are persisted in <code>SystemSetting</code> table; runtime override priority: DB &gt; env &gt; default.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleReload} disabled={reloadLoading}>
            <RotateCcw className={`w-4 h-4 mr-1 ${reloadLoading ? 'animate-spin' : ''}`} />
            {reloadLoading ? 'Reloading...' : 'Reload Cache'}
          </Button>
          <RefreshButton onClick={refresh} />
        </div>
      </div>

      {/* === Live runtime status (legacy cards, now under data.live) === */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Live Runtime Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Database</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>Provider: <Badge variant="outline">{data.live.database.provider}</Badge></div>
              <div>URL: <code className="text-muted-foreground">{data.live.database.url}</code></div>
              <div>pgvector: <Badge variant={data.live.database.extensions.pgvector ? 'success' : 'secondary'}>{data.live.database.extensions.pgvector ? 'enabled' : 'disabled'}</Badge></div>
              <div>Apache AGE: <Badge variant={data.live.database.extensions.age ? 'success' : 'secondary'}>{data.live.database.extensions.age ? 'enabled' : 'disabled'}</Badge></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">LLM</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>Available: <Badge variant={data.live.llm.available ? 'success' : 'destructive'}>{data.live.llm.available ? 'yes' : 'no'}</Badge></div>
              <div>Model: <code>{data.live.llm.model}</code></div>
              <div>API Key: <Badge variant={data.live.llm.apiKeyConfigured ? 'success' : 'warning'}>{data.live.llm.apiKeyConfigured ? 'configured' : 'missing'}</Badge></div>
              {data.live.llm.latencyMs !== undefined && <div>Latency: {data.live.llm.latencyMs}ms</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Embedding</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>Provider: <Badge variant="outline">{data.live.embedding.provider}</Badge></div>
              {data.live.embedding.model && <div>Model: <code>{data.live.embedding.model}</code></div>}
              {data.live.embedding.available !== undefined && (
                <div>Available: <Badge variant={data.live.embedding.available ? 'success' : 'destructive'}>{data.live.embedding.available ? 'yes' : 'no'}</Badge></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Event Mesh</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>Backend: <Badge variant="outline">{data.live.eventMesh.backend}</Badge></div>
              <div>Healthy: <Badge variant={data.live.eventMesh.healthy ? 'success' : 'destructive'}>{data.live.eventMesh.healthy ? 'yes' : 'no'}</Badge></div>
              <div>Subscribers: {data.live.eventMesh.details?.subscribers || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Observability</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>Langfuse: <Badge variant={data.live.observability.langfuseEnabled ? 'success' : 'secondary'}>{data.live.observability.langfuseEnabled ? 'enabled' : 'disabled'}</Badge></div>
              {data.live.observability.langfuseUrl && <div>URL: <code>{data.live.observability.langfuseUrl}</code></div>}
              <div>Integration: <Badge variant={data.live.integration.started ? 'success' : 'warning'}>{data.live.integration.started ? 'running' : 'stopped'}</Badge></div>
              <div>Active subscriptions: {data.live.integration.activeSubscriptions}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">MCP External Servers</CardTitle></CardHeader>
            <CardContent className="text-xs">
              {data.live.mcpExternalServers ? (
                <pre className="text-xs overflow-auto">{(() => {
                  try { return JSON.stringify(JSON.parse(data.live.mcpExternalServers), null, 2) } catch { return data.live.mcpExternalServers }
                })()}</pre>
              ) : (
                <span className="text-muted-foreground">None configured (set MCP_EXTERNAL_SERVERS or mcp.external_servers setting)</span>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* === Writable settings (C6) === */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Writable System Settings</h3>
        <SettingsEditor settings={data.settings} byCategory={data.byCategory} onSaved={refresh} />
      </div>
    </div>
  )
}

// === Settings editor (per-category cards with editable fields) =======

function SettingsEditor({
  settings,
  byCategory,
  onSaved,
}: {
  settings: SettingValue[]
  byCategory: Record<string, SettingValue[]>
  onSaved: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Sort categories by name for stable display, but put 'llm' first.
  const categoryOrder = ['llm', 'tools', 'mesh', 'observability', 'embedding', 'mcp', 'database', 'server', 'general']
  const categories = Object.keys(byCategory).sort((a, b) => {
    const ia = categoryOrder.indexOf(a)
    const ib = categoryOrder.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const updateDraft = (key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }))
  }

  const dirtyKeys = settings.filter((s) => drafts[s.key] !== undefined && drafts[s.key] !== s.value).map((s) => s.key)

  const saveAll = async () => {
    if (dirtyKeys.length === 0) {
      toast.info('No changes to save')
      return
    }
    const updates: Record<string, string> = {}
    for (const key of dirtyKeys) {
      updates[key] = drafts[key]!
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) {
        toast.error(`Save failed: HTTP ${res.status}`)
        return
      }
      const body = await res.json()
      const appliedCount = body.applied?.length ?? 0
      const rejectedCount = body.rejected?.length ?? 0

      if (appliedCount > 0) {
        toast.success(`Applied ${appliedCount} setting${appliedCount === 1 ? '' : 's'}`)
      }
      if (rejectedCount > 0) {
        const reasons = body.rejected.map((r: { key: string; reason: string }) => `${r.key}: ${r.reason}`).join('; ')
        toast.warning(`${rejectedCount} rejected — ${reasons}`)
      }

      // Clear drafts for applied keys; keep drafts for rejected keys so the user can fix them.
      const appliedKeys = new Set((body.applied ?? []).map((a: { key: string }) => a.key))
      setDrafts((d) => {
        const next: Record<string, string> = {}
        for (const [k, v] of Object.entries(d)) {
          if (!appliedKeys.has(k)) next[k] = v
        }
        return next
      })
      onSaved()
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const resetDraft = (key: string) => {
    setDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Sticky save bar */}
      <div className="sticky top-2 z-10 flex items-center justify-between bg-background/95 backdrop-blur border rounded-md p-2 shadow-sm">
        <div className="text-xs text-muted-foreground">
          {dirtyKeys.length > 0 ? (
            <span>{dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'}</span>
          ) : (
            <span>All settings in sync</span>
          )}
        </div>
        <div className="flex gap-2">
          {dirtyKeys.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDrafts({})}
              disabled={saving}
            >
              <X className="w-3 h-3 mr-1" /> Discard
            </Button>
          )}
          <Button
            size="sm"
            onClick={saveAll}
            disabled={saving || dirtyKeys.length === 0}
          >
            <Save className="w-3 h-3 mr-1" />
            {saving ? 'Saving...' : `Save${dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}`}
          </Button>
        </div>
      </div>

      {/* Per-category cards */}
      {categories.map((cat) => (
        <SettingsCategoryCard
          key={cat}
          category={cat}
          settings={byCategory[cat]}
          drafts={drafts}
          onDraft={updateDraft}
          onResetDraft={resetDraft}
        />
      ))}
    </div>
  )
}

function SettingsCategoryCard({
  category,
  settings,
  drafts,
  onDraft,
  onResetDraft,
}: {
  category: string
  settings: SettingValue[]
  drafts: Record<string, string>
  onDraft: (key: string, value: string) => void
  onResetDraft: (key: string) => void
}) {
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
  const writableCount = settings.filter((s) => !s.readOnly).length
  const readOnlyCount = settings.filter((s) => s.readOnly).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{categoryLabel}</CardTitle>
          <div className="flex gap-1">
            {writableCount > 0 && <Badge variant="secondary" className="text-xs">{writableCount} writable</Badge>}
            {readOnlyCount > 0 && <Badge variant="outline" className="text-xs">{readOnlyCount} read-only</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {settings.map((s) => {
          const draft = drafts[s.key]
          const isDirty = draft !== undefined && draft !== s.value
          const isBoolean = s.value === 'true' || s.value === 'false' || s.key.endsWith('_enabled')

          return (
            <SettingRow
              key={s.key}
              setting={s}
              draft={draft}
              isDirty={isDirty}
              isBoolean={isBoolean}
              onDraft={onDraft}
              onResetDraft={onResetDraft}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}

function SettingRow({
  setting,
  draft,
  isDirty,
  isBoolean,
  onDraft,
  onResetDraft,
}: {
  setting: SettingValue
  draft: string | undefined
  isDirty: boolean
  isBoolean: boolean
  onDraft: (key: string, value: string) => void
  onResetDraft: (key: string) => void
}) {
  const currentValue = draft !== undefined ? draft : setting.value
  const sourceVariant = setting.source === 'db' ? 'success' : setting.source === 'env' ? 'secondary' : 'outline'
  const sourceLabel = setting.source === 'db' ? 'DB override' : setting.source === 'env' ? 'env' : 'default'

  return (
    <div className="grid grid-cols-12 gap-2 items-start py-1 border-b last:border-b-0">
      {/* Key + description */}
      <div className="col-span-12 md:col-span-4">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono">{setting.key}</code>
          <Badge variant={sourceVariant} className="text-xs">{sourceLabel}</Badge>
          {setting.readOnly && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge variant="outline" className="text-xs">
                      <Lock className="w-3 h-3 mr-1" /> restart
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Read-only: changing this setting requires a server restart.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isDirty && (
            <Badge variant="warning" className="text-xs">unsaved</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{setting.description}</p>
        {setting.updatedAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Updated {new Date(setting.updatedAt).toLocaleString()}{setting.updatedBy ? ` by ${setting.updatedBy}` : ''}
          </p>
        )}
      </div>

      {/* Value editor */}
      <div className="col-span-12 md:col-span-8">
        {setting.readOnly ? (
          <Input
            value={currentValue}
            disabled
            className="text-xs font-mono bg-muted/50"
          />
        ) : isBoolean ? (
          <div className="flex items-center gap-3">
            <Switch
              checked={currentValue === 'true'}
              onCheckedChange={(checked) => onDraft(setting.key, checked ? 'true' : 'false')}
            />
            <span className="text-xs text-muted-foreground">{currentValue === 'true' ? 'enabled' : 'disabled'}</span>
            {isDirty && (
              <Button size="sm" variant="ghost" onClick={() => onResetDraft(setting.key)} className="h-6 px-2 text-xs">
                <RotateCcw className="w-3 h-3 mr-1" /> revert
              </Button>
            )}
          </div>
        ) : currentValue.length > 60 || currentValue.includes('\n') ? (
          <div className="space-y-1">
            <Textarea
              value={currentValue}
              onChange={(e) => onDraft(setting.key, e.target.value)}
              className="text-xs font-mono min-h-[60px]"
            />
            {isDirty && (
              <Button size="sm" variant="ghost" onClick={() => onResetDraft(setting.key)} className="h-6 px-2 text-xs">
                <RotateCcw className="w-3 h-3 mr-1" /> revert
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={currentValue}
              onChange={(e) => onDraft(setting.key, e.target.value)}
              className="text-xs font-mono"
            />
            {isDirty && (
              <Button size="sm" variant="ghost" onClick={() => onResetDraft(setting.key)} className="h-6 px-2 text-xs">
                <RotateCcw className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// === 2. Runtime Tab ==================================================

function RuntimeTab() {
  const { data, loading, error, refresh } = useAdminData<any>('runtime')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const runAction = async (action: string) => {
    setActionLoading(action)
    try {
      await fetch('/api/admin/runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      refresh()
    } finally { setActionLoading(null) }
  }

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (error) return <Card><CardContent className="p-4 text-destructive">{error}</CardContent></Card>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Runtime & Workers</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => runAction('recover')} disabled={actionLoading !== null}>
            <Play className="w-4 h-4 mr-1" /> {actionLoading === 'recover' ? 'Recovering...' : 'Recover Orphans'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => runAction('gc-consolidate')} disabled={actionLoading !== null}>
            GC Consolidate
          </Button>
          <Button size="sm" variant="outline" onClick={() => runAction('gc-archive')} disabled={actionLoading !== null}>
            GC Archive
          </Button>
          <RefreshButton onClick={refresh} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Running Plans" value={data.stats.runningPlans} tone={data.stats.runningPlans > 0 ? 'warn' : 'ok'} />
        <StatBox label="Running Tasks" value={data.stats.runningTasks} tone={data.stats.runningTasks > 0 ? 'warn' : 'ok'} />
        <StatBox label="Pending Jobs" value={data.stats.pendingJobs} />
        <StatBox label="Checkpoints" value={data.stats.totalCheckpoints} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Running Plans</CardTitle></CardHeader>
        <CardContent>
          {data.runningPlans.length > 0 ? (
            <div className="space-y-2 text-xs">
              {data.runningPlans.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between border rounded p-2">
                  <div>
                    <div className="font-medium">{p.goal}</div>
                    <div className="text-muted-foreground">{p.id} · {p.runningTasks} running tasks</div>
                  </div>
                  <Badge variant="warning">{p.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No running plans</p>
          )}
        </CardContent>
      </Card>

      {Object.keys(data.jobStats).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Job Queue Status</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(data.jobStats).map(([status, count]) => (
              <Badge key={status} variant="outline">{status}: {count as number}</Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// === 3. Tools Tab ====================================================

function ToolsTab() {
  const { data, loading, error, refresh } = useAdminData<any>('tools')
  const [testTool, setTestTool] = useState('')
  const [testResult, setTestResult] = useState<any>(null)
  const [testing, setTesting] = useState(false)

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', toolName: testTool, args: {} }),
      }).then((r) => r.json())
      setTestResult(res)
    } finally { setTesting(false) }
  }

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (error) return <Card><CardContent className="p-4 text-destructive">{error}</CardContent></Card>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Tools & Permissions</h2>
        <RefreshButton onClick={refresh} />
      </div>

      {/* Tool tester */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Test a Tool</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="tool name (e.g. filesystem.read)" value={testTool} onChange={(e) => setTestTool(e.target.value)} />
          <Button size="sm" onClick={runTest} disabled={testing || !testTool}>
            {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          </Button>
        </CardContent>
        {testResult && (
          <CardContent>
            <pre className="text-xs overflow-auto max-h-48 border rounded p-2">{JSON.stringify(testResult, null, 2)}</pre>
          </CardContent>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Builtin Tools ({data.builtin.length})</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1 max-h-64 overflow-auto">
            {data.builtin.map((t: any) => (
              <div key={t.name} className="border rounded p-1.5">
                <div className="font-medium">{t.name}</div>
                <div className="text-muted-foreground truncate">{t.description}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Registered Tools ({data.registered.length})</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1 max-h-64 overflow-auto">
            {data.registered.length > 0 ? data.registered.map((t: any) => (
              <div key={t.toolId} className="border rounded p-1.5">
                <div className="font-medium">{t.name} <Badge variant={t.active ? 'success' : 'secondary'}>{t.active ? 'active' : 'inactive'}</Badge></div>
                <div className="text-muted-foreground">{t.toolId} v{t.version}</div>
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {t.permissions.map((p: string) => <Badge key={p} variant="outline" className="text-xs">{p}</Badge>)}
                </div>
              </div>
            )) : <span className="text-muted-foreground">No registered tools</span>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">MCP External</CardTitle></CardHeader>
          <CardContent className="text-xs">
            <div>Servers: {data.mcpExternal.configuredServers}</div>
            <div>Discovered tools: {data.mcpExternal.discoveredTools}</div>
            {data.mcpExternal.serverNames.length > 0 && (
              <div className="mt-2">
                <div className="font-medium">Servers:</div>
                {data.mcpExternal.serverNames.map((s: string) => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// === 4. Governance Tab ===============================================

function GovernanceTab() {
  const { data, loading, error, refresh } = useAdminData<any>('governance')
  const [resolving, setResolving] = useState<string | null>(null)

  const resolveBlocked = async (id: string, choice: string) => {
    setResolving(`${id}:${choice}`)
    try {
      await fetch('/api/admin/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-blocked', blockedActionId: id, choice }),
      })
      refresh()
    } finally { setResolving(null) }
  }

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (error) return <Card><CardContent className="p-4 text-destructive">{error}</CardContent></Card>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Governance & Safety</h2>
        <RefreshButton onClick={refresh} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Blocked Actions" value={data.blockedActions.length} tone={data.blockedActions.length > 0 ? 'danger' : 'ok'} />
        <StatBox label="Approval Gates" value={data.approvalGates.length} tone={data.approvalGates.length > 0 ? 'warn' : 'ok'} />
        <StatBox label="Red Lines" value={data.redLines.length} />
        <StatBox label="LTL Rules" value={data.ltlRules.length} />
      </div>

      {/* Blocked Actions (HITL) */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Blocked Actions (HITL)</CardTitle></CardHeader>
        <CardContent>
          {data.blockedActions.length > 0 ? (
            <div className="space-y-2 text-xs">
              {data.blockedActions.map((b: any) => (
                <div key={b.id} className="border rounded p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{b.action}</div>
                      <div className="text-muted-foreground">{b.readableExplanation}</div>
                      <div className="text-muted-foreground mt-1">Agent: {b.agentId} · Source: {b.source}</div>
                    </div>
                    <Badge variant="destructive">{b.status}</Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" onClick={() => resolveBlocked(b.id, 'approved')} disabled={resolving !== null}>
                      <Check className="w-3 h-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => resolveBlocked(b.id, 'rejected')} disabled={resolving !== null}>
                      <X className="w-3 h-3 mr-1" /> Reject
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolveBlocked(b.id, 'modified')} disabled={resolving !== null}>
                      Modify
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolveBlocked(b.id, 'downgraded')} disabled={resolving !== null}>
                      Downgrade
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No blocked actions</p>
          )}
        </CardContent>
      </Card>

      {/* Red Lines */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Red Lines</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {data.redLines.map((r: any) => (
            <div key={r.id} className="border rounded p-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{r.description}</div>
                <div className="text-muted-foreground">{r.rationale}</div>
              </div>
              <Badge variant={r.severity === 'absolute' ? 'destructive' : r.severity === 'strong' ? 'warning' : 'secondary'}>
                {r.severity}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* LTL Rules */}
      <Card>
        <CardHeader><CardTitle className="text-sm">LTL Rules (active)</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {data.ltlRules.map((r: any) => (
            <div key={r.id} className="border rounded p-2">
              <div className="font-mono">{r.ltlFormula}</div>
              <div className="text-muted-foreground">{r.ruleId} · {r.severity}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// === 5. Memory Tab ===================================================

function MemoryTab() {
  const { data, loading, error, refresh } = useAdminData<any>('memory')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])

  const search = async () => {
    if (!searchQuery) return
    const res = await fetch('/api/admin/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: searchQuery, topK: 10 }),
    }).then((r) => r.json())
    setSearchResults(res.results || [])
  }

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (error) return <Card><CardContent className="p-4 text-destructive">{error}</CardContent></Card>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Memory & Context Graph</h2>
        <RefreshButton onClick={refresh} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Graph Nodes" value={data.graph?.totalNodes || 0} />
        <StatBox label="Graph Edges" value={data.graph?.totalEdges || 0} />
        <StatBox label="Memory Entries" value={data.memory?.totalMemories || 0} />
        <StatBox label="Hot" value={data.memory?.byTier?.hot || 0} tone="ok" />
        <StatBox label="Cold" value={data.memory?.byTier?.cold || 0} />
      </div>

      {/* Semantic Search */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Semantic Memory Search</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="search query..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <Button size="sm" onClick={search}>Search</Button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-1 text-xs max-h-64 overflow-auto">
              {searchResults.map((r: any, i: number) => (
                <div key={i} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{r.layer}</Badge>
                    <span className="text-muted-foreground">score: {r.score.toFixed(3)}</span>
                  </div>
                  <div className="mt-1">{r.content.slice(0, 200)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Graph stats by type */}
      {data.graph?.nodesByType && Object.keys(data.graph.nodesByType).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Nodes by Entity Type</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(data.graph.nodesByType).map(([type, count]) => (
              <Badge key={type} variant="outline">{type}: {count as number}</Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// === 6. Users Tab ====================================================

function UsersTab() {
  const { data, loading, error, refresh } = useAdminData<any>('users')

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (error) return <Card><CardContent className="p-4 text-destructive">{error}</CardContent></Card>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Users & Tenants</h2>
        <RefreshButton onClick={refresh} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Users ({data.users.length})</CardTitle></CardHeader>
        <CardContent className="text-xs">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2">Email</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Active</th>
                <th className="pb-2">Sessions</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u: any) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.email}</td>
                  <td>{u.name || '-'}</td>
                  <td><Badge variant={u.role === 'admin' ? 'destructive' : u.role === 'operator' ? 'warning' : 'secondary'}>{u.role}</Badge></td>
                  <td><Badge variant={u.active ? 'success' : 'secondary'}>{u.active ? 'yes' : 'no'}</Badge></td>
                  <td>{u.activeSessions}</td>
                  <td className="text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
