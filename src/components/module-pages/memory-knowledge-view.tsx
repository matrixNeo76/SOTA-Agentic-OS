'use client'

/**
 * Memory Knowledge View — C6.11 Fase 1 + C6.12 Fase 2
 *
 * Fase 1: error handling, upload, add memory, dark mode, auth fix
 * Fase 2: graph node browser, memory entry browser, unified search
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
import { Database, Search, Upload, Brain, Plus, FileText, Loader2, Network, GitFork, ChevronRight, ChevronDown, ArrowLeft, Layers, Eye, EyeOff, Filter, X, Clock, Download, Trash2, Archive, ArchiveRestore, Code2, Power, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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

      {/* C6.12 — Browsers + Unified Search */}
      <div className="mt-6">
        <Tabs defaultValue="graph" className="w-full">
          <TabsList className="grid w-full max-w-3xl grid-cols-7">
            <TabsTrigger value="graph" className="text-xs"><Network className="w-3.5 h-3.5 mr-1" />Graph</TabsTrigger>
            <TabsTrigger value="memory" className="text-xs"><Layers className="w-3.5 h-3.5 mr-1" />Memories</TabsTrigger>
            <TabsTrigger value="edges" className="text-xs"><GitFork className="w-3.5 h-3.5 mr-1" />Edges</TabsTrigger>
            <TabsTrigger value="search" className="text-xs"><Search className="w-3.5 h-3.5 mr-1" />Search</TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs"><Clock className="w-3.5 h-3.5 mr-1" />Timeline</TabsTrigger>
            <TabsTrigger value="rules" className="text-xs"><FileText className="w-3.5 h-3.5 mr-1" />Rules</TabsTrigger>
            <TabsTrigger value="gc" className="text-xs"><Brain className="w-3.5 h-3.5 mr-1" />GC</TabsTrigger>
          </TabsList>
          <TabsContent value="graph" className="mt-4">
            <GraphBrowser graphStats={graphStats ?? null} />
          </TabsContent>
          <TabsContent value="memory" className="mt-4">
            <MemoryBrowser />
          </TabsContent>
          <TabsContent value="edges" className="mt-4">
            <EdgeBrowser />
          </TabsContent>
          <TabsContent value="search" className="mt-4">
            <UnifiedSearch />
          </TabsContent>
          <TabsContent value="timeline" className="mt-4">
            <MemoryTimeline />
          </TabsContent>
          <TabsContent value="rules" className="mt-4">
            <RuleEditor />
          </TabsContent>
          <TabsContent value="gc" className="mt-4">
            <GCControls memStats={memStats ?? null} onRefresh={fetchData} />
            <div className="mt-4">
              <EmbeddingSimilarityViewer />
            </div>
          </TabsContent>
        </Tabs>
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

// === Graph Browser (C6.12 Fase 2) ====================================

function GraphBrowser({ graphStats }: { graphStats: GraphStats | null }) {
  const [nodes, setNodes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [entityType, setEntityType] = useState('all')
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [nodeDetail, setNodeDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const entityTypes = graphStats?.nodesByType ? Object.keys(graphStats.nodesByType) : []

  const fetchNodes = useCallback(async (append = false) => {
    setLoading(true)
    try {
      const offset = append ? nodes.length : 0
      const params = new URLSearchParams({ view: 'graph', limit: '25', offset: String(offset) })
      if (entityType !== 'all') params.set('entityType', entityType)
      const res = await fetch(`/api/memory/browse?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (append) setNodes(prev => [...prev, ...(d.nodes || [])])
      else setNodes(d.nodes || [])
      setTotal(d.total || 0)
      setHasMore(d.hasMore || false)
    } catch (err: any) {
      toast.error(`Failed to load graph nodes: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [entityType, nodes.length])

  useEffect(() => { fetchNodes(false) }, [entityType]) // eslint-disable-line

  const openNode = async (nodeId: string) => {
    setSelectedNode(nodeId)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/memory/browse?view=node&id=${nodeId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setNodeDetail(d)
    } catch (err: any) {
      toast.error(`Failed to load node: ${err.message}`)
    } finally {
      setDetailLoading(false)
    }
  }

  if (selectedNode) {
    return (
      <NodeDetailView
        detail={nodeDetail}
        loading={detailLoading}
        onBack={() => { setSelectedNode(null); setNodeDetail(null) }}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* C6.13 — Graph visualization */}
      <GraphViz graphStats={graphStats} />

      {/* Node browser */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Network className="w-4 h-4" /> Graph Node Browser
        </CardTitle>
        <CardDescription>{total} node{total === 1 ? '' : 's'} · click to view detail + edges</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filter */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="h-7 text-xs border rounded bg-background px-2"
            aria-label="Filter by entity type"
          >
            <option value="all">all types</option>
            {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {entityType !== 'all' && (
            <Button size="sm" variant="ghost" onClick={() => setEntityType('all')} className="h-7 text-xs">
              <X className="w-3 mr-0.5" /> Clear
            </Button>
          )}
        </div>

        {/* Node list */}
        {loading && nodes.length === 0 ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : nodes.length > 0 ? (
          <>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {nodes.map(n => (
                <div
                  key={n.id}
                  onClick={() => openNode(n.id)}
                  className="border rounded p-2 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className="text-[9px]">{n.entityType}</Badge>
                    <Badge variant="secondary" className="text-[9px]">{n.lifecycleState}</Badge>
                    <code className="font-mono text-[10px] truncate flex-1">{n.uri}</code>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>↗ {n.outgoingEdges} out</span>
                    <span>↙ {n.incomingEdges} in</span>
                    <span>conf: {n.confidence?.toFixed(2)}</span>
                    <span className="ml-auto">{new Date(n.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-2">
                <Button size="sm" variant="outline" onClick={() => fetchNodes(true)} disabled={loading}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Load more ({total - nodes.length} remaining)
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="Network" title="No graph nodes" description="Run workflows or extract documents to populate the Context Graph" />
        )}
      </CardContent>
      </Card>
    </div>
  )
}

// === Node Detail View (C6.12) ========================================

function NodeDetailView({ detail, loading, onBack }: { detail: any; loading: boolean; onBack: () => void }) {
  if (loading || !detail) {
    return (
      <Card>
        <CardContent className="p-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        </CardContent>
      </Card>
    )
  }

  const { node, outgoing, incoming } = detail

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back to Graph</Button>

        {/* Node info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{node.entityType}</Badge>
            <Badge variant="secondary">{node.lifecycleState}</Badge>
            <code className="font-mono text-xs">{node.uri}</code>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Created: {new Date(node.createdAt).toLocaleString()} · by {node.createdByAgent} · confidence: {node.confidence?.toFixed(2)}
          </div>
          {node.attributes && Object.keys(node.attributes).length > 0 && (
            <pre className="text-[10px] font-mono bg-muted/30 border rounded p-2 overflow-auto max-h-32">
              {JSON.stringify(node.attributes, null, 2)}
            </pre>
          )}
        </div>

        {/* Outgoing edges */}
        <div>
          <div className="text-xs font-medium mb-1">Outgoing Edges ({outgoing.length})</div>
          {outgoing.length > 0 ? (
            <div className="space-y-0.5">
              {outgoing.map((e: any) => (
                <div key={e.id} className="text-[11px] border-l-2 border-primary/30 pl-2">
                  <span className="font-mono">{e.relationType}</span> → <code className="text-[10px]">{e.target?.uri}</code>
                  <span className="text-muted-foreground ml-1">[{e.target?.entityType}]</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[10px] text-muted-foreground italic">None</p>}
        </div>

        {/* Incoming edges */}
        <div>
          <div className="text-xs font-medium mb-1">Incoming Edges ({incoming.length})</div>
          {incoming.length > 0 ? (
            <div className="space-y-0.5">
              {incoming.map((e: any) => (
                <div key={e.id} className="text-[11px] border-l-2 border-status-info/30 pl-2">
                  <code className="text-[10px]">{e.source?.uri}</code> <span className="font-mono">{e.relationType}</span> →
                  <span className="text-muted-foreground ml-1">[{e.source?.entityType}]</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[10px] text-muted-foreground italic">None</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// === Memory Browser (C6.12 Fase 2) ===================================

function MemoryBrowser() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [layer, setLayer] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [availableLayers, setAvailableLayers] = useState<string[]>([])
  const [availableAgents, setAvailableAgents] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // C6.15 — Delete/archive handlers for MemoryBrowser
  const handleDeleteEntry = async (id: string) => {
    if (!confirm('Delete this memory entry permanently?')) return
    try {
      const res = await fetch('/api/memory/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Delete failed: ${body.error}`); return }
      toast.success('Entry deleted')
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (err: any) { toast.error(`Delete failed: ${err.message}`) }
  }

  const handleArchiveEntry = async (id: string) => {
    try {
      const res = await fetch('/api/memory/manage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', id }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Archive failed: ${body.error}`); return }
      toast.success('Entry archived')
      setEntries(prev => prev.map(e => e.id === id ? { ...e, weight: 0 } : e))
    } catch (err: any) { toast.error(`Archive failed: ${err.message}`) }
  }

  const fetchEntries = useCallback(async (append = false) => {
    setLoading(true)
    try {
      const offset = append ? entries.length : 0
      const params = new URLSearchParams({ view: 'memory', limit: '25', offset: String(offset) })
      if (layer !== 'all') params.set('layer', layer)
      if (agentFilter !== 'all') params.set('agentUri', agentFilter)
      const res = await fetch(`/api/memory/browse?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (append) setEntries(prev => [...prev, ...(d.entries || [])])
      else setEntries(d.entries || [])
      setTotal(d.total || 0)
      setHasMore(d.hasMore || false)
      if (d.layers) setAvailableLayers(d.layers)
      if (d.agents) setAvailableAgents(d.agents)
    } catch (err: any) {
      toast.error(`Failed to load memory entries: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [layer, agentFilter, entries.length])

  useEffect(() => { fetchEntries(false) }, [layer, agentFilter]) // eslint-disable-line

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="w-4 h-4" /> Memory Entry Browser
        </CardTitle>
        <CardDescription>{total} entr{total === 1 ? 'y' : 'ies'} across all layers</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <select value={layer} onChange={(e) => setLayer(e.target.value)}
            className="h-7 text-xs border rounded bg-background px-2" aria-label="Filter by layer">
            <option value="all">all layers</option>
            {availableLayers.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}
            className="h-7 text-xs border rounded bg-background px-2" aria-label="Filter by agent"
            disabled={availableAgents.length === 0}>
            <option value="all">all agents</option>
            {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {(layer !== 'all' || agentFilter !== 'all') && (
            <Button size="sm" variant="ghost" onClick={() => { setLayer('all'); setAgentFilter('all') }} className="h-7 text-xs">
              <X className="w-3 mr-0.5" /> Clear
            </Button>
          )}
        </div>

        {/* Entry list */}
        {loading && entries.length === 0 ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : entries.length > 0 ? (
          <>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {entries.map(e => (
                <div key={e.id} className="border rounded text-xs">
                  <button
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                    className="w-full flex items-center gap-2 p-2 hover:bg-accent/30 transition-colors text-left"
                    aria-expanded={expandedId === e.id}
                  >
                    {expandedId === e.id ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                    <Badge variant="outline" className="text-[9px] shrink-0">{e.layer}</Badge>
                    <span className="truncate flex-1 text-[11px]">{e.content?.slice(0, 100)}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">w: {e.weight?.toFixed(2)}</span>
                  </button>
                  {expandedId === e.id && (
                    <div className="border-t bg-muted/20 p-2 space-y-2">
                      <div className="text-[11px] break-words">{e.content}</div>
                      {/* C6.15 — Enhanced provenance display */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">Agent:</span>
                          <code className="font-mono">{e.agentUri}</code>
                        </div>
                        {e.sourceUri && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground/60">Source:</span>
                            <code className="font-mono truncate" title={e.sourceUri}>{e.sourceUri}</code>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">Access:</span>
                          <span>{e.accessCount}x</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">Weight:</span>
                          <span className={cn('font-medium', e.weight === 0 ? 'text-status-warn' : e.weight > 0.7 ? 'text-status-ok' : '')}>{e.weight?.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">Utility:</span>
                          <span>{e.utilityScore?.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">Recency:</span>
                          <span>{e.recencyScore?.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">Created:</span>
                          <span>{new Date(e.createdAt).toLocaleString()}</span>
                        </div>
                        {e.lastAccessedAt && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground/60">Last access:</span>
                            <span>{new Date(e.lastAccessedAt).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                      {/* C6.15 — Provenance actions */}
                      <div className="flex gap-1 pt-1 border-t">
                        <button
                          onClick={(ev) => { ev.stopPropagation(); handleArchiveEntry(e.id) }}
                          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-status-warn"
                          aria-label="Archive entry"
                        >
                          <Archive className="w-2.5 h-2.5 inline mr-0.5" />Archive
                        </button>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); handleDeleteEntry(e.id) }}
                          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                          aria-label="Delete entry"
                        >
                          <Trash2 className="w-2.5 h-2.5 inline mr-0.5" />Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-2">
                <Button size="sm" variant="outline" onClick={() => fetchEntries(true)} disabled={loading}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Load more ({total - entries.length} remaining)
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="Layers" title="No memory entries" description="Memory entries are created by agents during execution" />
        )}
      </CardContent>
    </Card>
  )
}

// === Unified Search (C6.12 Fase 2) ===================================

function UnifiedSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [breakdown, setBreakdown] = useState<any>(null)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearched(true)
    try {
      const res = await fetch(`/api/memory/browse?view=search&q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setResults(d.results || [])
      setBreakdown(d.breakdown || null)
      if ((d.results || []).length === 0) toast.info('No results found')
      else toast.success(`Found ${d.results.length} result(s)`)
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`)
    } finally {
      setSearching(false)
    }
  }

  const sourceBadge = (source: string) => {
    const variant = source === 'graph' ? 'default' : source === 'entity' ? 'secondary' : source === 'episode' ? 'outline' : 'warning'
    return <Badge variant={variant as any} className="text-[9px]">{source}</Badge>
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="w-4 h-4" /> Unified Search
        </CardTitle>
        <CardDescription>Search across MemoryEntry, SemanticEntity, EpisodicMemory, and GraphNode</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-3">
          <Input
            placeholder="search across all memory sources..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            className="text-xs"
          />
          <Button size="sm" onClick={search} disabled={searching || !query.trim()}>
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </Button>
        </div>

        {/* Breakdown */}
        {breakdown && (
          <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
            <span>memory: {breakdown.memory}</span>
            <span>· entity: {breakdown.entity}</span>
            <span>· episode: {breakdown.episode}</span>
            <span>· graph: {breakdown.graph}</span>
          </div>
        )}

        {/* Results */}
        {results.length > 0 ? (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className="border rounded p-2 text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  {sourceBadge(r.source)}
                  <span className="font-medium truncate flex-1">{r.title}</span>
                  {r.timestamp && <span className="text-[10px] text-muted-foreground shrink-0">{new Date(r.timestamp).toLocaleDateString()}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground break-words">{r.description}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{r.meta}</p>
              </div>
            ))}
          </div>
        ) : searched ? (
          <EmptyState icon="Search" title="No results" description="Try a different search query" />
        ) : (
          <EmptyState icon="Search" title="Search all memory" description="Enter a query to search across all memory layers and the context graph" />
        )}
      </CardContent>
    </Card>
  )
}

// === Extraction Stats (C6.11) =========================================

// === Edge Browser (C6.13 Fase 3) =====================================

function EdgeBrowser() {
  const [edges, setEdges] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [relationType, setRelationType] = useState('all')
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [availableTypes, setAvailableTypes] = useState<string[]>([])

  const fetchEdges = useCallback(async (append = false) => {
    setLoading(true)
    try {
      const offset = append ? edges.length : 0
      const params = new URLSearchParams({ limit: '25', offset: String(offset) })
      if (relationType !== 'all') params.set('relationType', relationType)
      const res = await fetch(`/api/memory/edges?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (append) setEdges(prev => [...prev, ...(d.edges || [])])
      else setEdges(d.edges || [])
      setTotal(d.total || 0)
      setHasMore(d.hasMore || false)
      if (d.relationTypes) setAvailableTypes(d.relationTypes)
    } catch (err: any) {
      toast.error(`Failed to load edges: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [relationType, edges.length])

  useEffect(() => { fetchEdges(false) }, [relationType]) // eslint-disable-line

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitFork className="w-4 h-4" /> Edge Browser
        </CardTitle>
        <CardDescription>{total} edge{total === 1 ? '' : 's'} in the Context Graph</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filter */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <select
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
            className="h-7 text-xs border rounded bg-background px-2"
            aria-label="Filter by relation type"
          >
            <option value="all">all relation types</option>
            {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {relationType !== 'all' && (
            <Button size="sm" variant="ghost" onClick={() => setRelationType('all')} className="h-7 text-xs">
              <X className="w-3 mr-0.5" /> Clear
            </Button>
          )}
        </div>

        {/* Edge list */}
        {loading && edges.length === 0 ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : edges.length > 0 ? (
          <>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {edges.map(e => (
                <div key={e.id} className="border rounded p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">{e.relationType}</Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">{new Date(e.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <code className="font-mono truncate" title={e.from?.uri}>{e.from?.uri?.slice(0, 30)}</code>
                    <span className="text-muted-foreground shrink-0">[{e.from?.entityType}]</span>
                    <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                    <code className="font-mono truncate" title={e.to?.uri}>{e.to?.uri?.slice(0, 30)}</code>
                    <span className="text-muted-foreground shrink-0">[{e.to?.entityType}]</span>
                  </div>
                  {e.properties && Object.keys(e.properties).length > 0 && (
                    <pre className="text-[10px] font-mono bg-muted/30 border rounded p-1 overflow-auto max-h-16">
                      {JSON.stringify(e.properties, null, 1)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-2">
                <Button size="sm" variant="outline" onClick={() => fetchEdges(true)} disabled={loading}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Load more ({total - edges.length} remaining)
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="GitFork" title="No edges" description="Edges are created when entities are linked in the Context Graph" />
        )}
      </CardContent>
    </Card>
  )
}

// === GC Controls (C6.13 Fase 3) ======================================

function GCControls({ memStats, onRefresh }: { memStats: MemoryStats | null; onRefresh: () => void }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const runAction = async (action: string) => {
    setActionLoading(action)
    try {
      const res = await fetch('/api/cognitive-gc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`${action} failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      // Action-specific success messages
      if (action === 'consolidate') {
        toast.success(`Consolidation complete`, {
          description: `Consolidated: ${body.consolidated ?? 0} · Archived: ${body.archived ?? 0}`,
          duration: 6000,
        })
      } else if (action === 'update-decay') {
        toast.success(`Decay scores updated`, {
          description: `Updated: ${body.updated ?? 0} entries`,
          duration: 5000,
        })
      } else if (action === 'archive-cold') {
        toast.success(`Cold memories archived`, {
          description: `Archived: ${body.archived ?? 0} entries`,
          duration: 5000,
        })
      } else {
        toast.success(`${action} completed`)
      }
      onRefresh()
    } catch (err: any) {
      toast.error(`${action} failed: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const hot = memStats?.byTier?.hot ?? 0
  const warm = memStats?.byTier?.warm ?? 0
  const cold = memStats?.byTier?.cold ?? 0
  const total = memStats?.totalMemories ?? 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-4 h-4" /> Cognitive GC Controls
        </CardTitle>
        <CardDescription>
          Memory lifecycle: {total} total · Hot: {hot} · Warm: {warm} · Cold: {cold}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tier visualization */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="border rounded p-2">
            <div className="text-xl font-bold text-status-ok">{hot}</div>
            <div className="text-[10px] text-muted-foreground">Hot (active)</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-xl font-bold text-status-warn">{warm}</div>
            <div className="text-[10px] text-muted-foreground">Warm (aging)</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-xl font-bold text-status-info">{cold}</div>
            <div className="text-[10px] text-muted-foreground">Cold (archive)</div>
          </div>
        </div>

        {/* GC actions */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Actions</div>
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAction('consolidate')}
              disabled={actionLoading !== null}
              className="justify-start"
            >
              {actionLoading === 'consolidate' ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Brain className="w-3.5 h-3.5 mr-2" />}
              <div className="text-left">
                <div className="text-xs font-medium">Consolidate</div>
                <div className="text-[10px] text-muted-foreground">Cluster similar episodic memories → procedural rules</div>
              </div>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAction('update-decay')}
              disabled={actionLoading !== null}
              className="justify-start"
            >
              {actionLoading === 'update-decay' ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Database className="w-3.5 h-3.5 mr-2" />}
              <div className="text-left">
                <div className="text-xs font-medium">Update Decay</div>
                <div className="text-[10px] text-muted-foreground">Recalculate recency scores based on age</div>
              </div>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (cold === 0) {
                  toast.info('No cold memories to archive')
                  return
                }
                runAction('archive-cold')
              }}
              disabled={actionLoading !== null || cold === 0}
              className="justify-start"
            >
              {actionLoading === 'archive-cold' ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Database className="w-3.5 h-3.5 mr-2" />}
              <div className="text-left">
                <div className="text-xs font-medium">Archive Cold</div>
                <div className="text-[10px] text-muted-foreground">Move cold tier memories to archive ({cold} eligible)</div>
              </div>
            </Button>
          </div>
        </div>

        {/* By layer breakdown */}
        {memStats?.byLayer && Object.keys(memStats.byLayer).length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">By Layer</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(memStats.byLayer).map(([layer, count]) => (
                <Badge key={layer} variant="secondary" className="text-[10px]">
                  {layer}: {count as number}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground italic">
          GC runs automatically on a daily schedule. Use these controls to trigger manually.
        </div>
      </CardContent>
    </Card>
  )
}

// === Graph Visualization (C6.13 Fase 3) ==============================

function GraphViz({ graphStats }: { graphStats: GraphStats | null }) {
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const fetchGraph = useCallback(async () => {
    setLoading(true)
    try {
      const [nodesRes, edgesRes] = await Promise.all([
        fetch('/api/memory/browse?view=graph&limit=30').then(r => r.json()),
        fetch('/api/memory/edges?limit=50').then(r => r.json()),
      ])
      setNodes(nodesRes.nodes || [])
      setEdges(edgesRes.edges || [])
    } catch (err: any) {
      toast.error(`Failed to load graph: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        </CardContent>
      </Card>
    )
  }

  if (nodes.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <EmptyState icon="Network" title="Graph is empty" description="Run workflows or extract documents to populate the Context Graph" />
        </CardContent>
      </Card>
    )
  }

  // Simple circular layout for visualization
  const radius = Math.min(150, Math.max(80, nodes.length * 8))
  const centerX = 200
  const centerY = 150
  const nodePositions = new Map<string, { x: number; y: number }>()

  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2
    nodePositions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    })
  })

  // Color by entity type
  const typeColors: Record<string, string> = {
    Document: '#3b82f6',
    Claim: '#10b981',
    Skill: '#f59e0b',
    Agent: '#ef4444',
    Task: '#8b5cf6',
    Tool: '#06b6d4',
  }
  const defaultColor = '#6b7280'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Network className="w-4 h-4" /> Graph Visualization
        </CardTitle>
        <CardDescription>
          {nodes.length} nodes · {edges.length} edges · circular layout
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden bg-muted/10">
          <svg viewBox="0 0 400 300" className="w-full h-auto" style={{ maxHeight: '400px' }}>
            {/* Edges */}
            {edges.map((edge, i) => {
              const fromPos = nodePositions.get(edge.from?.id)
              const toPos = nodePositions.get(edge.to?.id)
              if (!fromPos || !toPos) return null
              return (
                <line
                  key={i}
                  x1={fromPos.x}
                  y1={fromPos.y}
                  x2={toPos.x}
                  y2={toPos.y}
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-border"
                  opacity="0.5"
                />
              )
            })}
            {/* Nodes */}
            {nodes.map((node) => {
              const pos = nodePositions.get(node.id)
              if (!pos) return null
              const color = typeColors[node.entityType] || defaultColor
              return (
                <g key={node.id}>
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r="6"
                    fill={color}
                    stroke="white"
                    strokeWidth="1.5"
                    className="cursor-pointer"
                  >
                    <title>{node.uri} [{node.entityType}]</title>
                  </circle>
                  <text
                    x={pos.x}
                    y={pos.y - 10}
                    textAnchor="middle"
                    className="text-[7px] fill-muted-foreground pointer-events-none"
                  >
                    {node.entityType}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(typeColors).map(([type, color]) => {
            const count = nodes.filter(n => n.entityType === type).length
            if (count === 0) return null
            return (
              <div key={type} className="flex items-center gap-1 text-[10px]">
                <span className="size-2 rounded-full" style={{ background: color }} />
                <span className="text-muted-foreground">{type}: {count}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// === Memory Timeline (C6.14 Fase 4) ==================================

function MemoryTimeline() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)

  const fetchTimeline = useCallback(async (append = false) => {
    setLoading(true)
    try {
      const offset = append ? entries.length : 0
      const params = new URLSearchParams({ view: 'memory', limit: '20', offset: String(offset) })
      const res = await fetch(`/api/memory/browse?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (append) setEntries(prev => [...prev, ...(d.entries || [])])
      else setEntries(d.entries || [])
      setTotal(d.total || 0)
      setHasMore(d.hasMore || false)
    } catch (err: any) {
      toast.error(`Failed to load timeline: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [entries.length])

  useEffect(() => { fetchTimeline(false) }, []) // eslint-disable-line

  // C6.14 — Export JSON
  const exportJSON = () => {
    if (entries.length === 0) { toast.warning('No entries to export'); return }
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `memory-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${entries.length} entries as JSON`)
  }

  // C6.14 — Export CSV
  const exportCSV = () => {
    if (entries.length === 0) { toast.warning('No entries to export'); return }
    const headers = ['id', 'layer', 'agentUri', 'content', 'weight', 'createdAt']
    const rows = entries.map(e => [
      e.id,
      e.layer,
      `"${e.agentUri}"`,
      `"${(e.content || '').replace(/"/g, '""').slice(0, 200)}"`,
      e.weight?.toFixed(2) || '0',
      new Date(e.createdAt).toISOString(),
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `memory-export-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${entries.length} entries as CSV`)
  }

  // C6.14 — Delete entry
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory entry permanently?')) return
    try {
      const res = await fetch('/api/memory/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Delete failed: ${body.error}`); return }
      toast.success('Entry deleted')
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`)
    }
  }

  // C6.14 — Archive entry
  const handleArchive = async (id: string) => {
    try {
      const res = await fetch('/api/memory/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', id }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Archive failed: ${body.error}`); return }
      toast.success('Entry archived')
      setEntries(prev => prev.map(e => e.id === id ? { ...e, weight: 0 } : e))
    } catch (err: any) {
      toast.error(`Archive failed: ${err.message}`)
    }
  }

  // Group entries by date for timeline view
  const grouped = entries.reduce((acc: Record<string, any[]>, e) => {
    const date = new Date(e.createdAt).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
    if (!acc[date]) acc[date] = []
    acc[date].push(e)
    return acc
  }, {} as Record<string, any[]>)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" /> Memory Timeline
            </CardTitle>
            <CardDescription>{total} entr{total === 1 ? 'y' : 'ies'} in chronological order</CardDescription>
          </div>
          {/* C6.14 — Export buttons */}
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={exportJSON} disabled={entries.length === 0} className="h-7 px-2 text-xs">
              <Download className="w-3 h-3 mr-0.5" /> JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={exportCSV} disabled={entries.length === 0} className="h-7 px-2 text-xs">
              <Download className="w-3 h-3 mr-0.5" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && entries.length === 0 ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : entries.length > 0 ? (
          <>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {Object.entries(grouped).map(([date, items]) => (
                <div key={date}>
                  {/* Date header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-px bg-border flex-1" />
                    <span className="text-[10px] font-medium text-muted-foreground px-2">{date}</span>
                    <div className="h-px bg-border flex-1" />
                  </div>
                  {/* Entries for this date */}
                  <div className="space-y-1">
                    {items.map(e => (
                      <div key={e.id} className="flex items-start gap-2 border rounded p-2 text-xs group">
                        {/* Time */}
                        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                          {new Date(e.createdAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Badge variant="outline" className="text-[9px]">{e.layer}</Badge>
                            <span className="text-[10px] text-muted-foreground">{e.agentUri}</span>
                            {e.weight === 0 && <Badge variant="secondary" className="text-[9px]">archived</Badge>}
                          </div>
                          <p className="text-[11px] break-words">{e.content?.slice(0, 150)}</p>
                        </div>
                        {/* Actions (visible on hover) */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => handleArchive(e.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-status-warn" title="Archive">
                            <Archive className="w-3 h-3" />
                          </button>
                          <button onClick={() => handleDelete(e.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Delete">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-2">
                <Button size="sm" variant="outline" onClick={() => fetchTimeline(true)} disabled={loading}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Load more ({total - entries.length} remaining)
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="Clock" title="No memory entries" description="Memory entries are created by agents during execution" />
        )}
      </CardContent>
    </Card>
  )
}

// === Rule Editor (C6.14 Fase 4) ======================================

function RuleEditor() {
  const [rules, setRules] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  // Form state
  const [ruleId, setRuleId] = useState('')
  const [expression, setExpression] = useState('')
  const [dependencies, setDependencies] = useState('')
  const [priority, setPriority] = useState('0')

  const fetchRules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/memory/rules')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setRules(d.rules || [])
    } catch (err: any) {
      toast.error(`Failed to load rules: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  const startNew = () => {
    setEditing(null)
    setRuleId(''); setExpression(''); setDependencies(''); setPriority('0')
    setShowForm(true)
  }

  const startEdit = (rule: any) => {
    setEditing(rule)
    setRuleId(rule.ruleId)
    setExpression(rule.expression)
    setDependencies(rule.dependencies?.join(', ') || '')
    setPriority(String(rule.priority || 0))
    setShowForm(true)
  }

  const save = async () => {
    if (!ruleId.trim() || !expression.trim()) {
      toast.error('Rule ID and expression are required')
      return
    }
    setSaving(true)
    try {
      const deps = dependencies ? dependencies.split(',').map(s => s.trim()).filter(Boolean) : []
      const body: any = {
        action: editing ? 'update' : 'create',
        ruleId, expression, dependencies: deps,
        priority: parseInt(priority) || 0,
      }
      if (editing) body.id = editing.id

      const res = await fetch('/api/memory/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resBody = await res.json()
      if (!res.ok) {
        toast.error(`Save failed: ${resBody.error}`)
        return
      }
      toast.success(editing ? 'Rule updated' : 'Rule created')
      setShowForm(false)
      setEditing(null)
      fetchRules()
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (id: string) => {
    setToggling(id)
    try {
      const res = await fetch('/api/memory/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', id }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Toggle failed: ${body.error}`); return }
      toast.success(`Rule ${body.active ? 'activated' : 'deactivated'}`)
      setRules(prev => prev.map(r => r.id === id ? { ...r, active: body.active } : r))
    } catch (err: any) {
      toast.error(`Toggle failed: ${err.message}`)
    } finally {
      setToggling(null)
    }
  }

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this rule permanently?')) return
    try {
      const res = await fetch('/api/memory/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(`Delete failed: ${body.error}`); return }
      toast.success('Rule deleted')
      setRules(prev => prev.filter(r => r.id !== id))
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Code2 className="w-4 h-4" /> Logical Rule Editor
            </CardTitle>
            <CardDescription>{rules.length} rule{rules.length === 1 ? '' : 's'} · {rules.filter(r => r.active).length} active</CardDescription>
          </div>
          <Button size="sm" onClick={startNew}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Form */}
        {showForm && (
          <div className="border rounded p-3 mb-3 space-y-2 bg-muted/10">
            <div className="text-xs font-medium">{editing ? 'Edit Rule' : 'New Rule'}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Rule ID *</Label>
                <Input value={ruleId} onChange={e => setRuleId(e.target.value)} placeholder="rule_auth_001" className="text-xs font-mono" disabled={!!editing} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Priority</Label>
                <Input type="number" value={priority} onChange={e => setPriority(e.target.value)} className="text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Expression * <span className="text-muted-foreground">(IF…THEN… syntax)</span></Label>
              <Textarea value={expression} onChange={e => setExpression(e.target.value)} placeholder="IF user.role == 'admin' THEN allow" className="text-xs font-mono min-h-[60px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Dependencies (comma-separated rule IDs)</Label>
              <Input value={dependencies} onChange={e => setDependencies(e.target.value)} placeholder="rule_auth_000" className="text-xs font-mono" />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setEditing(null) }}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                {saving ? 'Saving…' : 'Save Rule'}
              </Button>
            </div>
          </div>
        )}

        {/* Rule list */}
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rules.length > 0 ? (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {rules.map(r => (
              <div key={r.id} className="border rounded p-2 text-xs group">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={r.active ? 'success' : 'secondary'} className="text-[9px]">{r.active ? 'active' : 'inactive'}</Badge>
                  <code className="font-mono text-[10px] font-medium">{r.ruleId}</code>
                  <span className="text-[10px] text-muted-foreground">priority: {r.priority}</span>
                  <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => toggle(r.id)} disabled={toggling === r.id} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-status-warn" title={r.active ? 'Deactivate' : 'Activate'}>
                      {toggling === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                    </button>
                    <button onClick={() => startEdit(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="Edit">
                      <Code2 className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteRule(r.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <pre className="text-[10px] font-mono bg-muted/30 border rounded p-1.5 overflow-auto max-h-16 break-words whitespace-pre-wrap">{r.expression}</pre>
                {r.dependencies && r.dependencies.length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">deps: {r.dependencies.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="Code2" title="No logical rules" description="Create rules to define logical constraints and dependencies" />
        )}
      </CardContent>
    </Card>
  )
}

// === Embedding Similarity Viewer (C6.15 Fase 5) ======================

function EmbeddingSimilarityViewer() {
  const [entities, setEntities] = useState<{ id: string; name: string; type: string }[]>([])
  const [entityA, setEntityA] = useState('')
  const [entityB, setEntityB] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/memory/similarity')
      .then(r => r.json())
      .then(d => { if (d.entities) setEntities(d.entities) })
      .catch(() => {})
  }, [])

  const compare = async () => {
    if (!entityA) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ entityA })
      if (entityB) params.set('entityB', entityB)
      const res = await fetch(`/api/memory/similarity?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setResult(d)
    } catch (err: any) {
      toast.error(`Similarity check failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="w-4 h-4" /> Embedding Similarity Viewer
        </CardTitle>
        <CardDescription>Debug tool: compare entity embeddings via cosine similarity</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {entities.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No entities with embeddings available.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Entity A *</Label>
                <select value={entityA} onChange={e => setEntityA(e.target.value)}
                  className="w-full h-7 text-xs border rounded bg-background px-2" aria-label="Select entity A">
                  <option value="">— select —</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.name} ({e.type})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Entity B (optional — leave empty for top-5 similar)</Label>
                <select value={entityB} onChange={e => setEntityB(e.target.value)}
                  className="w-full h-7 text-xs border rounded bg-background px-2" aria-label="Select entity B">
                  <option value="">— top 5 similar —</option>
                  {entities.filter(e => e.id !== entityA).map(e => <option key={e.id} value={e.id}>{e.name} ({e.type})</option>)}
                </select>
              </div>
            </div>
            <Button size="sm" onClick={compare} disabled={!entityA || loading} className="text-xs">
              {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1" />}
              {loading ? 'Computing…' : 'Compare'}
            </Button>

            {/* Result */}
            {result && (
              <div className="border rounded p-2 space-y-1.5 text-xs">
                {result.similarity !== undefined ? (
                  // Pairwise comparison
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{result.entityA?.name}</span>
                      <span className="text-muted-foreground">vs</span>
                      <span className="font-medium">{result.entityB?.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Cosine similarity:</span>
                      <span className={cn('text-lg font-bold', result.similarity > 0.8 ? 'text-status-ok' : result.similarity > 0.5 ? 'text-status-warn' : 'text-status-danger')}>
                        {(result.similarity * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">Dimensions: {result.dimensions}</div>
                    {/* Visual bar */}
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', result.similarity > 0.8 ? 'bg-status-ok' : result.similarity > 0.5 ? 'bg-status-warn' : 'bg-status-danger')}
                        style={{ width: `${Math.max(2, result.similarity * 100)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  // Top-5 similar
                  <>
                    <div className="font-medium mb-1">Most similar to: {result.entityA?.name}</div>
                    {result.topSimilar?.length > 0 ? (
                      <div className="space-y-1">
                        {result.topSimilar.map((s: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground shrink-0">#{i + 1}</span>
                            <span className="flex-1 truncate">{s.name} ({s.type})</span>
                            <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                              <div
                                className={cn('h-full rounded-full', s.similarity > 0.8 ? 'bg-status-ok' : s.similarity > 0.5 ? 'bg-status-warn' : 'bg-status-danger')}
                                style={{ width: `${Math.max(2, s.similarity * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums shrink-0 w-10 text-right">{(s.similarity * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">No similar entities found</p>
                    )}
                    <div className="text-[10px] text-muted-foreground">Dimensions: {result.dimensions}</div>
                  </>
                )}
              </div>
            )}
          </>
        )}
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
