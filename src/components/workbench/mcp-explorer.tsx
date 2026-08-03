'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Plug, PlugZap, Trash2, RefreshCw, Search, Shield, ShieldCheck,
  Loader2, Play, AlertTriangle, CheckCircle2, XCircle,
  Server, Wrench, Activity,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

type Connection = {
  id: string
  name: string
  endpoint: string
  protocol: string
  authType: string
  status: string
  isTrusted: boolean
  toolCount: number
  lastHandshake: string | null
  lastError: string | null
  _count?: { externalTools: number }
}

type Stats = {
  connections: Record<string, number>
  executions: Record<string, number>
  totalTools: number
  trustedTools: number
}

type CachedTool = {
  id: string
  toolName: string
  description: string | null
  inputSchema: any
  isTrusted: boolean
  enabled: boolean
  callCount: number
  errorCount: number
  avgLatencyMs: number
}

type Execution = {
  id: string
  toolName: string
  status: string
  durationMs: number
  errorMessage: string | null
  createdAt: string
  signatureValid: boolean | null
}

const STATUS_STYLES: Record<string, { color: string; icon: any }> = {
  connected: { color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
  disconnected: { color: 'text-zinc-500', icon: XCircle },
  error: { color: 'text-red-600 dark:text-red-400', icon: AlertTriangle },
  revoked: { color: 'text-amber-600 dark:text-amber-400', icon: AlertTriangle },
}

export function McpExplorer() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [details, setDetails] = useState<{
    connection: Connection & { externalTools: CachedTool[] }
    recentExecutions: Execution[]
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [executeTool, setExecuteTool] = useState<string | null>(null)
  const [executeArgs, setExecuteArgs] = useState('{}')
  const [executeResult, setExecuteResult] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mcp-client')
      const d = await r.json()
      setConnections(d.connections || [])
      setStats(d.stats || null)
    } catch {
      toast.error('Errore caricamento connessioni MCP')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const loadDetails = async (id: string) => {
    setSelectedId(id)
    setDetails(null)
    try {
      const r = await fetch('/api/mcp-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get', connectionId: id }),
      })
      const d = await r.json()
      setDetails(d)
    } catch {
      toast.error('Errore caricamento dettagli')
    }
  }

  const handleAction = async (action: string, connectionId: string, label: string) => {
    setBusy(`${action}-${connectionId}`)
    try {
      const r = await fetch('/api/mcp-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, connectionId }),
      })
      const d = await r.json()
      if (d.ok !== false && !d.error) {
        toast.success(`${label} completato`)
        await load()
        if (selectedId) await loadDetails(selectedId)
      } else {
        toast.error(d.error || `${label} fallito`)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questa connessione e tutti i tool cacheati?')) return
    await handleAction('delete', id, 'Eliminazione')
    setSelectedId(null)
    setDetails(null)
  }

  const handleExecute = async (toolName: string) => {
    if (!selectedId) return
    setBusy(`execute-${toolName}`)
    setExecuteResult(null)
    try {
      const args = JSON.parse(executeArgs)
      const r = await fetch('/api/mcp-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          connectionId: selectedId,
          toolName,
          arguments: args,
        }),
      })
      const d = await r.json()
      if (d.ok) {
        setExecuteResult(JSON.stringify(d.output, null, 2))
        toast.success(`Esecuzione OK in ${d.durationMs}ms`)
      } else {
        setExecuteResult(`ERROR: ${d.error}`)
        toast.error(d.error || 'Esecuzione fallita')
      }
    } catch (e: any) {
      setExecuteResult(`PARSE ERROR: ${e.message}`)
      toast.error('JSON argomenti non valido')
    } finally {
      setBusy(null)
    }
  }

  const handleToggleTool = async (toolId: string, enabled: boolean) => {
    try {
      await fetch('/api/mcp-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-tool', toolId, enabled: !enabled }),
      })
      toast.success(`Tool ${!enabled ? 'abilitato' : 'disabilitato'}`)
      if (selectedId) await loadDetails(selectedId)
    } catch {
      toast.error('Errore toggle tool')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">MCP Explorer</h2>
          <Badge variant="secondary" className="text-[10px]">{connections.length} connessioni</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setShowRegister(!showRegister)}>
            <PlugZap className="size-3.5 mr-1.5" />Connetti
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="Connections" value={Object.values(stats.connections).reduce((a, b) => a + b, 0)} icon={Plug} />
          <StatCard label="Connected" value={stats.connections.connected || 0} icon={CheckCircle2} color="text-emerald-600 dark:text-emerald-400" />
          <StatCard label="Tools" value={stats.totalTools} icon={Wrench} />
          <StatCard label="Trusted" value={stats.trustedTools} icon={ShieldCheck} color="text-violet-600 dark:text-violet-400" />
        </div>
      )}

      {showRegister && <RegisterForm onRegistered={() => { load(); setShowRegister(false) }} />}

      <div className="grid lg:grid-cols-[1fr,1.5fr] gap-4">
        <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
          {connections.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground italic">
                Nessuna connessione MCP. Clicca "Connetti" per registrare un server MCP esterno.
              </p>
            </div>
          ) : (
            connections.map(conn => {
              const statusStyle = STATUS_STYLES[conn.status] || STATUS_STYLES.disconnected
              const StatusIcon = statusStyle.icon
              const isSelected = selectedId === conn.id
              return (
                <button
                  key={conn.id}
                  onClick={() => loadDetails(conn.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-md border transition-all',
                    isSelected ? 'border-primary bg-primary/10' : 'hover:bg-accent/40'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <StatusIcon className={cn('size-4 shrink-0 mt-0.5', statusStyle.color)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{conn.name}</span>
                        {conn.isTrusted && (
                          <Badge variant="outline" className="text-[8px] py-0 gap-0.5">
                            <ShieldCheck className="size-2.5" />TRUSTED
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">{conn.endpoint}</div>
                      <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                        <span className="font-mono">{conn.toolCount || conn._count?.externalTools || 0} tools</span>
                        <span>·</span>
                        <span className="capitalize">{conn.protocol}</span>
                        <span>·</span>
                        <span className="uppercase">{conn.authType}</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="border rounded-lg p-4 max-h-[500px] overflow-y-auto">
          {!details ? (
            <div className="text-center py-12 text-xs text-muted-foreground italic">
              <Server className="size-6 mx-auto mb-2 opacity-30" />
              Seleziona una connessione per visualizzare tool, esecuzioni e dettagli.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    {details.connection.name}
                    {details.connection.isTrusted && (
                      <Badge variant="outline" className="text-[9px] gap-0.5">
                        <ShieldCheck className="size-2.5" /> TRUSTED
                      </Badge>
                    )}
                  </h3>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{details.connection.endpoint}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => handleAction('handshake', details.connection.id, 'Handshake')} disabled={busy === `handshake-${details.connection.id}`}>
                    {busy === `handshake-${details.connection.id}` ? <Loader2 className="size-3 animate-spin" /> : <Plug className="size-3" />}
                    <span className="ml-1">HS</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAction('discover', details.connection.id, 'Discover')} disabled={busy === `discover-${details.connection.id}`}>
                    {busy === `discover-${details.connection.id}` ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
                    <span className="ml-1">Find</span>
                  </Button>
                  {!details.connection.isTrusted && details.connection.authType === 'ecdsa' && (
                    <Button size="sm" variant="outline" onClick={() => handleAction('trust', details.connection.id, 'Trust')} disabled={busy === `trust-${details.connection.id}`}>
                      {busy === `trust-${details.connection.id}` ? <Loader2 className="size-3 animate-spin" /> : <Shield className="size-3" />}
                      <span className="ml-1">Trust</span>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => handleDelete(details.connection.id)}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>

              {details.connection.lastError && (
                <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 text-[10px] text-red-600 dark:text-red-400">
                  <AlertTriangle className="size-3 inline mr-1" />
                  {details.connection.lastError}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <Wrench className="size-3" /> Tool cacheati ({details.connection.externalTools.length})
                  </Label>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {details.connection.externalTools.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground italic py-2">
                      Nessun tool. Esegui "Find" per scoprirli.
                    </p>
                  ) : (
                    details.connection.externalTools.map(tool => (
                      <div key={tool.id} className="rounded-md border p-2 text-[11px]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium">{tool.toolName}</span>
                            {tool.isTrusted && (
                              <Badge variant="outline" className="text-[8px] py-0 gap-0.5">
                                <ShieldCheck className="size-2" />T
                              </Badge>
                            )}
                            {!tool.enabled && <Badge variant="outline" className="text-[8px] py-0">OFF</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setExecuteTool(tool.toolName); setExecuteResult(null) }}
                              className="p-1 hover:bg-accent rounded"
                              title="Esegui"
                            >
                              <Play className="size-3" />
                            </button>
                            <button
                              onClick={() => handleToggleTool(tool.id, tool.enabled)}
                              className="p-1 hover:bg-accent rounded"
                              title={tool.enabled ? 'Disabilita' : 'Abilita'}
                            >
                              {tool.enabled ? <XCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
                            </button>
                          </div>
                        </div>
                        {tool.description && (
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{tool.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground">
                          <span className="font-mono">{tool.callCount} calls</span>
                          {tool.errorCount > 0 && <span className="text-red-500">{tool.errorCount} err</span>}
                          {tool.avgLatencyMs > 0 && <span className="font-mono">{tool.avgLatencyMs.toFixed(0)}ms</span>}
                        </div>

                        {executeTool === tool.toolName && (
                          <div className="mt-2 space-y-1.5 border-t pt-2">
                            <Label className="text-[10px]">Arguments (JSON)</Label>
                            <Textarea
                              value={executeArgs}
                              onChange={(e) => setExecuteArgs(e.target.value)}
                              rows={3}
                              className="text-[10px] font-mono"
                              placeholder='{"key": "value"}'
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                className="h-6 text-[10px]"
                                onClick={() => handleExecute(tool.toolName)}
                                disabled={busy === `execute-${tool.toolName}`}
                              >
                                {busy === `execute-${tool.toolName}` ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                                <span className="ml-1">Run</span>
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setExecuteTool(null)}>
                                Chiudi
                              </Button>
                            </div>
                            {executeResult && (
                              <pre className="mt-1 p-2 rounded bg-surface-code text-surface-code-foreground text-[10px] font-mono max-h-32 overflow-auto whitespace-pre-wrap">
                                {executeResult}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium flex items-center gap-1 mb-2">
                  <Activity className="size-3" /> Esecuzioni recenti
                </Label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {details.recentExecutions.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground italic">Nessuna esecuzione registrata.</p>
                  ) : (
                    details.recentExecutions.map(ex => {
                      const Icon = ex.status === 'success' ? CheckCircle2 : ex.status === 'timeout' ? AlertTriangle : XCircle
                      const color = ex.status === 'success' ? 'text-emerald-500' : ex.status === 'timeout' ? 'text-amber-500' : 'text-red-500'
                      return (
                        <div key={ex.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-border/30">
                          <Icon className={cn('size-3 shrink-0', color)} />
                          <span className="font-mono font-medium">{ex.toolName}</span>
                          <span className="text-muted-foreground font-mono">{ex.durationMs}ms</span>
                          {ex.signatureValid !== null && (
                            <Badge variant="outline" className="text-[8px] py-0">
                              {ex.signatureValid ? 'SIG OK' : 'SIG FAIL'}
                            </Badge>
                          )}
                          <span className="text-muted-foreground ml-auto">
                            {new Date(ex.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color?: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-2 flex items-center gap-2">
      <Icon className={cn('size-4 shrink-0', color || 'text-muted-foreground')} />
      <div>
        <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
        <div className="font-mono font-semibold text-sm">{value}</div>
      </div>
    </div>
  )
}

function RegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [protocol, setProtocol] = useState('jsonrpc')
  const [authType, setAuthType] = useState('none')
  const [authToken, setAuthToken] = useState('')
  const [publisherFingerprint, setPublisherFingerprint] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    if (!name || !endpoint) {
      toast.error('Nome e endpoint sono obbligatori')
      return
    }
    setLoading(true)
    try {
      const r = await fetch('/api/mcp-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          name,
          endpoint,
          protocol,
          authType,
          authToken: authToken || undefined,
          publisherFingerprint: publisherFingerprint || undefined,
        }),
      })
      const d = await r.json()
      if (d.ok) {
        toast.success('Connessione registrata. Ora esegui handshake.')
        onRegistered()
      } else {
        toast.error(d.error || 'Errore')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <PlugZap className="size-3.5" /> Nuova connessione MCP
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" placeholder="my-mcp-server" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Protocollo</Label>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value)}
            className="w-full h-9 rounded-md border bg-background px-3 text-sm">
            <option value="jsonrpc">JSON-RPC</option>
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Endpoint URL</Label>
        <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="h-9 text-sm font-mono" placeholder="https://mcp.example.com/rpc" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Auth type</Label>
          <select value={authType} onChange={(e) => setAuthType(e.target.value)}
            className="w-full h-9 rounded-md border bg-background px-3 text-sm">
            <option value="none">None</option>
            <option value="bearer">Bearer</option>
            <option value="basic">Basic</option>
            <option value="ecdsa">ECDSA</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Auth token / Publisher ID</Label>
          <Input value={authToken} onChange={(e) => setAuthToken(e.target.value)} className="h-9 text-sm font-mono" placeholder="(opzionale)" />
        </div>
      </div>
      {authType === 'ecdsa' && (
        <div className="space-y-1">
          <Label className="text-xs">Publisher fingerprint (SHA-256 chiave pubblica)</Label>
          <Input value={publisherFingerprint} onChange={(e) => setPublisherFingerprint(e.target.value)} className="h-9 text-sm font-mono" placeholder="ab12cd34…" />
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleRegister} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <PlugZap className="size-3.5 mr-1.5" />}
          Registra
        </Button>
      </div>
    </div>
  )
}
