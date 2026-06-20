'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'
import { toast } from 'sonner'
import {
  Package, RefreshCw, Plus, Trash2, Shield, KeyRound, CheckCircle2, XCircle,
  Lock, Unlock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tool = {
  id: string
  toolId: string
  name: string
  version: string
  signature: string
  description: string | null
  publisher: string | null
  active: boolean
  installedAt: string
  installedBy: string | null
  revokedAt: string | null
  revokeReason: string | null
  permissions: { scope: string; granted: boolean; constraint: string | null }[]
  grantedCount: number
  totalCount: number
}

export function ToolManager() {
  const [tools, setTools] = useState<Tool[]>([])
  const [stats, setStats] = useState<any>(null)
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)

  // Install form
  const [newToolId, setNewToolId] = useState('custom-tool')
  const [newName, setNewName] = useState('Custom Tool')
  const [newVersion, setNewVersion] = useState('1.0.0')
  const [newDescription, setNewDescription] = useState('')
  const [newPublisher, setNewPublisher] = useState('admin')

  const refresh = async () => {
    const [toolsR, statsR] = await Promise.all([
      fetch('/api/tools').then((r) => r.json()),
      fetch('/api/tools?action=stats').then((r) => r.json()),
    ])
    setTools(toolsR.tools || [])
    setStats(statsR)
    if (!selectedTool && (toolsR.tools || []).length > 0) {
      setSelectedTool(toolsR.tools[0])
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [])

  const install = async () => {
    if (!newToolId.trim() || !newName.trim() || !newVersion.trim()) {
      toast.error('toolId, name, version obbligatori')
      return
    }
    const r = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'install',
        toolId: newToolId,
        name: newName,
        version: newVersion,
        description: newDescription,
        publisher: newPublisher,
      }),
    })
    const d = await r.json()
    if (d.ok) {
      toast.success(`Tool ${newName} installato · signature: ${d.signature.slice(0, 16)}…`)
      setNewToolId('custom-tool')
      refresh()
    } else toast.error(d.error)
  }

  const revoke = async (toolId: string) => {
    const r = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', toolId, reason: 'revoked by admin' }),
    })
    const d = await r.json()
    if (d.ok) { toast.success('Tool revocato'); refresh() }
  }

  const togglePermission = async (toolId: string, scope: string, granted: boolean) => {
    const r = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_permission', toolId, scope, granted: !granted }),
    })
    const d = await r.json()
    if (d.ok) {
      // Aggiorna localmente
      if (selectedTool && selectedTool.toolId === toolId) {
        setSelectedTool({
          ...selectedTool,
          permissions: selectedTool.permissions.map((p) =>
            p.scope === scope ? { ...p, granted: !granted } : p
          ),
          grantedCount: selectedTool.grantedCount + (!granted ? 1 : -1),
        })
      }
      toast.success(`${scope}: ${!granted ? 'concesso' : 'revocato'}`)
    } else toast.error(d.error)
  }

  const installBuiltin = async (tool: any) => {
    const r = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'install',
        toolId: tool.toolId,
        name: tool.name,
        version: tool.version,
        description: tool.description,
        publisher: tool.publisher,
      }),
    })
    const d = await r.json()
    if (d.ok) { toast.success(`${tool.name} installato`); refresh() }
    else toast.error(d.error)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PhaseHeader
        phaseId="tools"
        action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>}
      />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Tool totali" value={stats.total} />
          <StatCard label="Attivi" value={stats.active} highlight />
          <StatCard label="Revocati" value={stats.revoked} warn={stats.revoked > 0} />
          <StatCard label="Permessi" value={stats.totalPerms} />
          <StatCard label="Concessi" value={stats.grantedPerms} highlight />
        </div>
      )}

      <Tabs defaultValue="installed" className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="installed"><Package className="size-3.5 mr-1.5" /> Installati</TabsTrigger>
          <TabsTrigger value="install"><Plus className="size-3.5 mr-1.5" /> Installa</TabsTrigger>
          <TabsTrigger value="builtin">Predefiniti</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="space-y-4 mt-4">
          <div className="grid lg:grid-cols-[1fr,1.5fr] gap-4">
            {/* Lista tool */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Tool installati</CardTitle>
                <CardDescription>{tools.length} tool</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-96 pr-2">
                  {tools.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Nessun tool installato. Vai al tab "Installa".</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {tools.map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => setSelectedTool(t)}
                            className={cn(
                              'w-full text-left text-xs border rounded-md p-2.5 transition-colors',
                              selectedTool?.id === t.id
                                ? 'border-primary bg-primary/10'
                                : 'hover:bg-muted/50',
                              !t.active && 'opacity-50'
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Package className="size-3 shrink-0" />
                              <span className="font-medium truncate">{t.name}</span>
                              <Badge variant="outline" className="text-[9px] py-0 font-mono">v{t.version}</Badge>
                              {!t.active && <Badge variant="secondary" className="text-[9px] py-0 bg-red-500">revocato</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {t.grantedCount}/{t.totalCount} permessi · {t.toolId}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Dettaglio tool + permessi */}
            {selectedTool && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Package className="size-4 text-primary" />
                        {selectedTool.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        v{selectedTool.version} · by {selectedTool.publisher || 'unknown'}
                      </CardDescription>
                    </div>
                    {selectedTool.active && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => revoke(selectedTool.toolId)}
                      >
                        <Trash2 className="size-3 mr-1" /> Revoca
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedTool.description && (
                    <div className="text-xs text-muted-foreground">{selectedTool.description}</div>
                  )}

                  {/* Signature */}
                  <div className="border rounded-md p-2 bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Signature crittografica</div>
                    <div className="font-mono text-[11px] flex items-center gap-1.5">
                      <KeyRound className="size-3 text-emerald-500" />
                      {selectedTool.signature}
                    </div>
                  </div>

                  {/* Permessi a grana fine */}
                  <div>
                    <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
                      <Shield className="size-3" />
                      Permessi a grana fine
                      <Badge variant="outline" className="text-[9px] ml-auto">
                        {selectedTool.grantedCount}/{selectedTool.totalCount} concessi
                      </Badge>
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {selectedTool.permissions.map((p) => (
                        <div key={p.scope} className={cn(
                          'flex items-center gap-2 text-xs border rounded-md p-2',
                          p.granted ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border'
                        )}>
                          {p.granted
                            ? <Unlock className="size-3 text-emerald-500 shrink-0" />
                            : <Lock className="size-3 text-muted-foreground shrink-0" />}
                          <code className="font-mono text-[11px] flex-1">{p.scope}</code>
                          <Switch
                            checked={p.granted}
                            onCheckedChange={() => togglePermission(selectedTool.toolId, p.scope, p.granted)}
                            disabled={!selectedTool.active}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="install" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Installa nuovo tool</CardTitle>
              <CardDescription>
                I tool sono identificati da signature crittografica, non per similarità semantica
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tool ID</Label>
                  <Input value={newToolId} onChange={(e) => setNewToolId(e.target.value)} placeholder="github-integration" />
                </div>
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Versione</Label>
                  <Input value={newVersion} onChange={(e) => setNewVersion(e.target.value)} placeholder="1.0.0" />
                </div>
                <div>
                  <Label className="text-xs">Publisher</Label>
                  <Input value={newPublisher} onChange={(e) => setNewPublisher(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Descrizione</Label>
                <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Cosa fa questo tool?" />
              </div>
              <Button size="sm" onClick={install}>
                <Plus className="size-3.5 mr-1.5" /> Installa
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="builtin" className="space-y-4 mt-4">
          <BuiltinTools onInstall={installBuiltin} installed={tools.map((t) => t.toolId)} />
        </TabsContent>
      </Tabs>

      <RelatedPhases links={[
        link('phase8', 'Permessi → contratti', 'I permessi concessi alimentano le pre/post-conditions Lean4'),
        link('phase9', 'Permessi = delega', 'I permessi tool sono un tipo di DelegationContract'),
        link('phase4', 'Taint + Tool', 'I tool ricevono input tainted tracciati da TaintTracker'),
        link('cockpit', 'Audit in cockpit', 'Le installazioni tool appaiono nel tab Log del Cockpit'),
      ]} />
    </div>
  )
}

function BuiltinTools({ onInstall, installed }: { onInstall: (t: any) => void; installed: string[] }) {
  const [builtin, setBuiltin] = useState<any[]>([])
  useEffect(() => {
    fetch('/api/tools?action=builtin').then((r) => r.json()).then((d) => setBuiltin(d.tools || []))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tool predefiniti</CardTitle>
        <CardDescription>Tool ufficiali firmati da sota-os-official</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-3 gap-3">
          {builtin.map((t) => {
            const isInstalled = installed.includes(t.toolId)
            return (
              <div key={t.toolId} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Package className="size-4 text-primary" />
                  <span className="text-sm font-medium">{t.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">v{t.version} · {t.publisher}</div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
                {isInstalled ? (
                  <Badge variant="secondary" className="text-[10px] bg-emerald-500">
                    <CheckCircle2 className="size-3 mr-1" /> Installato
                  </Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onInstall(t)}>
                    <Plus className="size-3 mr-1" /> Installa
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function StatCard({ label, value, highlight, warn }: { label: string; value: number | string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="bg-card border rounded-md p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className={cn(
        'text-2xl font-bold font-mono',
        highlight && 'text-emerald-600 dark:text-emerald-400',
        warn && 'text-amber-600 dark:text-amber-400',
      )}>{value}</div>
    </div>
  )
}
