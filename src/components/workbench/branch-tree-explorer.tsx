'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  GitBranch, ChevronRight, ChevronDown, Trash2, ArrowRight,
  Folder, FolderOpen, Loader2, RefreshCw, Clock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Branch = {
  id: string
  parentId: string
  messageId: string
  title: string
  taskText: string
  createdAt: string
}

export function BranchTreeExplorer() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/conversation/branch')
      const d = await r.json()
      setBranches(d.branches || [])
    } catch {
      toast.error('Errore caricamento branch')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch('/api/conversation/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', branchId: id }),
      })
      toast.success('Branch eliminato')
      load()
    } catch {
      toast.error('Errore eliminazione branch')
    }
  }

  const handleLoad = async (id: string) => {
    try {
      const r = await fetch('/api/conversation/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get', branchId: id }),
      })
      const d = await r.json()
      if (d.ok && d.branch) {
        // Store branch messages in sessionStorage for Console to pick up
        sessionStorage.setItem('branch_load', JSON.stringify({
          branchId: id,
          messages: d.branch.messages,
          timestamp: Date.now(),
        }))
        toast.success(`Branch "${d.branch.title}" caricato. Vai alla Console per visualizzarlo.`)
        setSelectedId(id)
      }
    } catch {
      toast.error('Errore caricamento branch')
    }
  }

  // Build tree structure
  const tree = buildTree(branches)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (branches.length === 0) {
    return (
      <div className="text-center py-12 space-y-3">
        <div className="size-12 mx-auto rounded-xl bg-muted flex items-center justify-center">
          <GitBranch className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold">Nessun branch</h3>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          I branch vengono creati quando clicchi l'icona <GitBranch className="size-3 inline" /> su un messaggio nella Console.
          Ogni branch è uno snapshot della conversazione da quel punto.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Branch Tree</h2>
          <Badge variant="secondary" className="text-[10px]">{branches.length} branch</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-3.5 mr-1.5" />Aggiorna
        </Button>
      </div>

      <div className="rounded-lg border bg-card/50 p-2 space-y-0.5 max-h-96 overflow-y-auto">
        {tree.map(node => (
          <BranchNode
            key={node.id}
            node={node}
            level={0}
            expanded={expanded}
            onToggle={toggleExpand}
            onSelect={handleLoad}
            onDelete={handleDelete}
            selectedId={selectedId}
          />
        ))}
      </div>
    </div>
  )
}

type TreeNode = Branch & { children: TreeNode[] }

function buildTree(branches: Branch[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const b of branches) {
    map.set(b.id, { ...b, children: [] })
  }

  for (const b of branches) {
    const node = map.get(b.id)!
    if (b.parentId === 'root' || !map.has(b.parentId)) {
      roots.push(node)
    } else {
      map.get(b.parentId)!.children.push(node)
    }
  }

  return roots
}

function BranchNode({
  node, level, expanded, onToggle, onSelect, onDelete, selectedId,
}: {
  node: TreeNode
  level: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  selectedId: string | null
}) {
  const isExpanded = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors',
          isSelected ? 'bg-primary/10' : 'hover:bg-accent/40'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(node.id) }}
            className="size-4 flex items-center justify-center shrink-0"
          >
            {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {hasChildren ? (
          isExpanded ? <FolderOpen className="size-3.5 text-primary shrink-0" /> : <Folder className="size-3.5 text-primary shrink-0" />
        ) : (
          <GitBranch className="size-3.5 text-muted-foreground shrink-0" />
        )}

        <span className="flex-1 min-w-0 truncate font-medium">{node.title}</span>

        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
          {new Date(node.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
        </span>

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(node.id) }}
          className="size-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
          title="Elimina branch"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <BranchNode
              key={child.id}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onDelete={onDelete}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
