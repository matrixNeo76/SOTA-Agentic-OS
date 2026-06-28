'use client'

/**
 * Memory Knowledge View — C6.11 Fase 1
 *
 * Fixes:
 *   - Error handling with toast (distinguish empty DB from fetch error)
 *   - Working "Upload Document" button with file picker → /api/knowledge-extraction
 *   - Dark mode aware colors (status tokens instead of hardcoded)
 *   - Single fetch source (/api/admin/memory includes graph + memory stats)
 *   - Add Memory form (episode/entity/rule) → POST /api/memory
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Database, Search, Upload, Brain, Plus, FileText, Loader2, Network, GitFork } from 'lucide-react'
import { cn } from '@/lib/utils'

// === Types ============================================================

interface GraphStats {
  totalNodes: number
  totalEdges: number
  nodesByType: Record<string, number>
}

interface MemoryStats {
  totalMemories: number
  byLayer: Record<string, number>
  byTier: { hot: number; warm: number; cold: number }
  avgWeight: number
}

interface MemoryData {
  graph: GraphStats
  memory: MemoryStats
}

// === Main component ===================================================

export function MemoryKnowledgeView() {
  const [data, setData] = useState<MemoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [showAddMemory, setShowAddMemory] = useState(false)
  const [showExtract, setShowExtract] = useState(false)

  // C6.11 — Single fetch with proper error handling
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/memory')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const d = await res.json()
      setData(d)
    } catch (err: any) {
      setError(err.message)
      toast.error(`Failed to load memory data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // C6.11 — Search with error handling
  const search = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch('/api/admin/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', query: searchQuery, topK: 10 }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const d = await res.json()
      setSearchResults(d.results || [])
      if ((d.results || []).length === 0) {
        toast.info('No results found')
      } else {
        toast.success(`Found ${d.results.length} result(s)`)
      }
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`)
    } finally {
      setSearching(false)
    }
  }

  const graphStats = data?.graph
  const memStats = data?.memory
  const isEmpty = !loading && !error && (
    (graphStats?.totalNodes ?? 0) === 0 &&
    (memStats?.totalMemories ?? 0) === 0
  )

  return (
    <ModulePage
      title="Memory & Knowledge"
      description="Context Graph · Memory Fabric · Knowledge Extraction"
      icon="Database"
      loading={loading}
      onRefresh={fetchData}
      stats={[
        { label: 'Graph Nodes', value: graphStats?.totalNodes ?? 0, icon: 'Network' },
        { label: 'Graph Edges', value: graphStats?.totalEdges ?? 0, icon: 'GitFork' },
        { label: 'Memory Entries', value: memStats?.totalMemories ?? 0, icon: 'Brain' },
        { label: 'Cold Tier', value: memStats?.byTier?.cold ?? 0, tone: 'warn' as const, icon: 'Snowflake' },
      ]}
    >
      {/* C6.11 — Action buttons */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Button size="sm" onClick={() => setShowAddMemory(s => !s)}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          {showAddMemory ? 'Close' : 'Add Memory'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowExtract(s => !s)}>
          <Upload className="w-3.5 h-3.5 mr-1" />
          {showExtract ? 'Close' : 'Extract Document'}
        </Button>
      </div>

      {/* C6.11 — Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-status-danger/10 border border-status-danger/20 text-xs text-status-danger mb-4">
          <span className="font-medium">Error loading data:</span>
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="ghost" onClick={fetchData} className="h-6 px-2 text-xs">Retry</Button>
        </div>
      )}

      {/* C6.11 — Add Memory form */}
      {showAddMemory && <AddMemoryCard onCreated={fetchData} />}

      {/* C6.11 — Knowledge Extraction form */}
      {showExtract && <ExtractDocumentCard onExtracted={fetchData} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Semantic Search */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Search className="w-4 h-4" /> Semantic Memory Search
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="Search memories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                className="text-xs"
              />
              <Button size="sm" onClick={search} disabled={searching || !searchQuery.trim()}>
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {searchResults.length > 0 ? (
              <div className="space-y-1 max-h-64 overflow-auto">
                {searchResults.map((r, i) => (
                  <div key={i} className="border rounded p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline">{r.layer}</Badge>
                      <span className="text-muted-foreground">score: {r.score?.toFixed(3) ?? '—'}</span>
                    </div>
                    <p className="break-words">{r.content?.slice(0, 200) ?? JSON.stringify(r).slice(0, 200)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="Search"
                title="No results yet"
                description="Enter a search query to find relevant memories across all layers"
              />
            )}
          </CardContent>
        </Card>

        {/* Graph Stats by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Network className="w-4 h-4" /> Graph by Entity Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            {graphStats?.nodesByType && Object.keys(graphStats.nodesByType).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(graphStats.nodesByType).map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-sm">
                    {type}: {count as number}
                  </Badge>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="Network"
                title={isEmpty ? "Graph is empty" : "No data loaded"}
                description="Upload documents or run workflows to populate the Context Graph"
              />
            )}
          </CardContent>
        </Card>

        {/* Memory Tiers — C6.11 dark mode aware */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4" /> Memory Tiers
            </CardTitle>
            <CardDescription>
              {memStats?.totalMemories ?? 0} total · avg weight: {(memStats?.avgWeight ?? 0).toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-status-ok">{memStats?.byTier?.hot ?? 0}</div>
              <div className="text-xs text-muted-foreground">Hot</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-status-warn">{memStats?.byTier?.warm ?? 0}</div>
              <div className="text-xs text-muted-foreground">Warm</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-status-info">{memStats?.byTier?.cold ?? 0}</div>
              <div className="text-xs text-muted-foreground">Cold</div>
            </div>
          </CardContent>
          {/* C6.11 — Memory by layer breakdown */}
          {memStats?.byLayer && Object.keys(memStats.byLayer).length > 0 && (
            <CardContent className="pt-0">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">By Layer</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(memStats.byLayer).map(([layer, count]) => (
                  <Badge key={layer} variant="secondary" className="text-[10px]">
                    {layer}: {count as number}
                  </Badge>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Knowledge Extraction summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" /> Extraction Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExtractionStats />
          </CardContent>
        </Card>
      </div>
    </ModulePage>
  )
}

// === Add Memory Card (C6.11) ==========================================

function AddMemoryCard({ onCreated }: { onCreated: () => void }) {
  const [type, setType] = useState<'episode' | 'entity' | 'rule'>('episode')
  const [saving, setSaving] = useState(false)

  // Episode fields
  const [observation, setObservation] = useState('')
  const [source, setSource] = useState('')
  const [agentId, setAgentId] = useState('')
  const [tags, setTags] = useState('')

  // Entity fields
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('')
  const [description, setDescription] = useState('')
  const [attributes, setAttributes] = useState('')

  // Rule fields
  const [ruleId, setRuleId] = useState('')
  const [expression, setExpression] = useState('')
  const [dependencies, setDependencies] = useState('')
  const [priority, setPriority] = useState('0')

  const submit = async () => {
    setSaving(true)
    try {
      const body: any = { type }
      if (type === 'episode') {
        if (!observation.trim()) { toast.error('Observation is required'); setSaving(false); return }
        body.observation = observation
        body.source = source || 'manual'
        body.agentId = agentId || 'manual'
        body.tags = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []
      } else if (type === 'entity') {
        if (!name.trim()) { toast.error('Name is required'); setSaving(false); return }
        body.name = name
        body.type = entityType || 'concept'
        body.description = description
        body.attributes = attributes ? JSON.parse(attributes) : {}
      } else if (type === 'rule') {
        if (!ruleId.trim() || !expression.trim()) { toast.error('Rule ID and expression are required'); setSaving(false); return }
        body.ruleId = ruleId
        body.expression = expression
        body.dependencies = dependencies ? dependencies.split(',').map((t: string) => t.trim()).filter(Boolean) : []
        body.priority = parseInt(priority) || 0
      }

      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resBody = await res.json()
      if (!res.ok) {
        toast.error(`Failed: ${resBody.error || `HTTP ${res.status}`}`)
        return
      }
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} added successfully`)

      // Clear form
      setObservation(''); setSource(''); setAgentId(''); setTags('')
      setName(''); setEntityType(''); setDescription(''); setAttributes('')
      setRuleId(''); setExpression(''); setDependencies(''); setPriority('0')

      onCreated()
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Memory
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Type selector */}
        <div className="flex gap-2">
          {(['episode', 'entity', 'rule'] as const).map(t => (
            <Button
              key={t}
              size="sm"
              variant={type === t ? 'default' : 'outline'}
              onClick={() => setType(t)}
              className="text-xs"
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>

        {/* Episode form */}
        {type === 'episode' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Observation *</Label>
              <Textarea value={observation} onChange={(e) => setObservation(e.target.value)}
                placeholder="What was observed?" className="text-xs min-h-[60px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)}
                placeholder="manual" className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Agent ID</Label>
              <Input value={agentId} onChange={(e) => setAgentId(e.target.value)}
                placeholder="manual" className="text-xs" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)}
                placeholder="auth, security" className="text-xs" />
            </div>
          </div>
        )}

        {/* Entity form */}
        {type === 'entity' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="UserAuthentication" className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Input value={entityType} onChange={(e) => setEntityType(e.target.value)}
                placeholder="concept" className="text-xs" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this entity?" className="text-xs min-h-[60px]" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Attributes (JSON)</Label>
              <Input value={attributes} onChange={(e) => setAttributes(e.target.value)}
                placeholder='{"key": "value"}' className="text-xs font-mono" />
            </div>
          </div>
        )}

        {/* Rule form */}
        {type === 'rule' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Rule ID *</Label>
              <Input value={ruleId} onChange={(e) => setRuleId(e.target.value)}
                placeholder="rule_auth_001" className="text-xs font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)}
                className="text-xs" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Expression *</Label>
              <Textarea value={expression} onChange={(e) => setExpression(e.target.value)}
                placeholder="IF user.role == 'admin' THEN allow" className="text-xs font-mono min-h-[60px]" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Dependencies (comma-separated rule IDs)</Label>
              <Input value={dependencies} onChange={(e) => setDependencies(e.target.value)}
                placeholder="rule_auth_000" className="text-xs font-mono" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            {saving ? 'Saving…' : `Add ${type.charAt(0).toUpperCase() + type.slice(1)}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// === Extract Document Card (C6.11) ====================================

function ExtractDocumentCard({ onExtracted }: { onExtracted: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState('manual-upload')
  const [extracting, setExtracting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File | null) => {
    if (!f) return
    setFile(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const extract = async () => {
    if (!file) {
      toast.error('Choose a file first')
      return
    }
    setExtracting(true)
    try {
      // Read file as base64
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1]
        const uri = `doc://${file.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`
        const mimeType = file.type || 'text/plain'

        const res = await fetch('/api/knowledge-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri, content: base64, mimeType, source }),
        })
        const body = await res.json()
        if (!res.ok) {
          toast.error(`Extraction failed: ${body.error || `HTTP ${res.status}`}`)
          setExtracting(false)
          return
        }
        toast.success('Document extracted', {
          description: `${body.chunks || 0} chunks, ${body.entities || 0} entities, ${body.graphNodesCreated || 0} graph nodes`,
          duration: 6000,
        })
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        onExtracted()
        setExtracting(false)
      }
      reader.onerror = () => {
        toast.error('Failed to read file')
        setExtracting(false)
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      toast.error(`Extraction failed: ${err.message}`)
      setExtracting(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Upload className="w-4 h-4" /> Knowledge Extraction
        </CardTitle>
        <CardDescription>Upload a document to extract entities, relations, and embeddings into the Context Graph</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* File picker / drag-drop */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            file ? 'border-status-ok/40 bg-status-ok/5' : 'border-border hover:border-primary/40 hover:bg-accent/30',
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="text/*,application/json,application/pdf,.md,.txt,.csv"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
          {file ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-status-ok" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          ) : (
            <div className="space-y-1">
              <Upload className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Click to choose or drag-drop a file</p>
              <p className="text-[10px] text-muted-foreground/70">Supports: .txt, .md, .json, .csv, .pdf</p>
            </div>
          )}
        </div>

        {/* Source field */}
        <div className="space-y-1">
          <Label className="text-xs">Source</Label>
          <Input value={source} onChange={(e) => setSource(e.target.value)}
            placeholder="manual-upload" className="text-xs" />
        </div>

        {/* Extract button */}
        <div className="flex justify-end">
          <Button size="sm" onClick={extract} disabled={!file || extracting}>
            {extracting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
            {extracting ? 'Extracting…' : 'Extract'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// === Extraction Stats (C6.11) =========================================

function ExtractionStats() {
  const [stats, setStats] = useState<{ documentNodes: number; claimNodes: number } | null>(null)

  useEffect(() => {
    fetch('/api/knowledge-extraction')
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => {})
  }, [])

  if (!stats) return <p className="text-xs text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Documents</span>
        <Badge variant="outline">{stats.documentNodes}</Badge>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Claims extracted</span>
        <Badge variant="outline">{stats.claimNodes}</Badge>
      </div>
      {stats.documentNodes === 0 && stats.claimNodes === 0 && (
        <p className="text-xs text-muted-foreground italic mt-2">
          No documents extracted yet. Use the Extract Document button above.
        </p>
      )}
    </div>
  )
}
