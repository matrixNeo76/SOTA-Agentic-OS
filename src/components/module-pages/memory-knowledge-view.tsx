'use client'

/**
 * Memory Knowledge View — UX-2
 *
 * Area "Memory & Knowledge": Context Graph browser + Memory Fabric + Knowledge Extraction
 */

import { useState, useEffect, useCallback } from 'react'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Database, Search, Upload, Brain } from 'lucide-react'

export function MemoryKnowledgeView() {
  const [graphStats, setGraphStats] = useState<any>(null)
  const [memStats, setMemStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [graphRes, memRes] = await Promise.all([
        fetch('/api/admin/memory').then((r) => r.json()).catch(() => null),
        fetch('/api/cognitive-gc').then((r) => r.json()).catch(() => null),
      ])
      setGraphStats(graphRes)
      setMemStats(memRes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const search = async () => {
    if (!searchQuery) return
    const res = await fetch('/api/admin/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: searchQuery, topK: 10 }),
    }).then((r) => r.json()).catch(() => ({ results: [] }))
    setSearchResults(res.results || [])
  }

  return (
    <ModulePage
      title="Memory & Knowledge"
      description="Context Graph · Memory Fabric · Knowledge Extraction"
      icon="Database"
      loading={loading}
      onRefresh={fetchData}
      stats={[
        { label: 'Graph Nodes', value: graphStats?.graph?.totalNodes ?? 0, icon: 'Network' },
        { label: 'Graph Edges', value: graphStats?.graph?.totalEdges ?? 0, icon: 'GitFork' },
        { label: 'Memory Entries', value: memStats?.totalMemories ?? 0, icon: 'Brain' },
        { label: 'Cold Tier', value: memStats?.byTier?.cold ?? 0, tone: 'warn' as const, icon: 'Snowflake' },
      ]}
    >
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
              />
              <Button size="sm" onClick={search}>Search</Button>
            </div>
            {searchResults.length > 0 ? (
              <div className="space-y-1 max-h-64 overflow-auto">
                {searchResults.map((r, i) => (
                  <div key={i} className="border rounded p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline">{r.layer}</Badge>
                      <span className="text-muted-foreground">score: {r.score?.toFixed(3)}</span>
                    </div>
                    <p className="truncate">{r.content?.slice(0, 150)}</p>
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
              <Brain className="w-4 h-4" /> Graph by Entity Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            {graphStats?.graph?.nodesByType && Object.keys(graphStats.graph.nodesByType).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(graphStats.graph.nodesByType).map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-sm">
                    {type}: {count as number}
                  </Badge>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="Network"
                title="Graph is empty"
                description="Upload documents or run workflows to populate the Context Graph"
              />
            )}
          </CardContent>
        </Card>

        {/* Memory Tiers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Memory Tiers</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-green-600">{memStats?.byTier?.hot ?? 0}</div>
              <div className="text-xs text-muted-foreground">Hot</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-600">{memStats?.byTier?.warm ?? 0}</div>
              <div className="text-xs text-muted-foreground">Warm</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{memStats?.byTier?.cold ?? 0}</div>
              <div className="text-xs text-muted-foreground">Cold</div>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Extraction */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Upload className="w-4 h-4" /> Knowledge Extraction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon="Upload"
              title="Extract documents"
              description="Upload a document to extract entities, relations, and embeddings into the Context Graph"
              action={<Button size="sm" variant="outline">Upload Document</Button>}
            />
          </CardContent>
        </Card>
      </div>
    </ModulePage>
  )
}
