'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
 Target, RefreshCw, Plus, CheckCircle2, XCircle, SkipForward,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'
import { ObjectiveTreeVisualizer } from './dag-visualizers'

type TreeNode = {
 id: string; treeId: string; parentId: string | null;
 description: string; depth: number; weight: number;
 contextTier: string; status: string; evidence: string | null; evaluatedAt: string | null
}

type Tree = {
 tree: { id: string; rootGoal: string; status: string; totalNodes: number; maxDepth: number }
 nodes: TreeNode[]
}

const TIER_COLOR: Record<string, string> = {
 strategic: 'border-status-info bg-status-info',
 methodological: 'border-cat-cognitive bg-cat-cognitive',
 implementation: 'border-status-ok bg-status-ok',
}

const STATUS_ICON: Record<string, any> = {
 pass: CheckCircle2,
 fail: XCircle,
 skipped: SkipForward,
 pending: null,
}

export function Phase12() {
 const [trees, setTrees] = useState<any[]>([])
 const [stats, setStats] = useState<any>(null)
 const [selectedTree, setSelectedTree] = useState<Tree | null>(null)
 const [rootGoal, setRootGoal] = useState('Ottimizza il processo di deploy del microservizio auth')

 const refresh = async () => {
 const [treesR, statsR] = await Promise.all([
 fetch('/api/objective?action=list').then((r) => r.json()),
 fetch('/api/objective?action=stats').then((r) => r.json()),
 ])
 setTrees(treesR.trees || [])
 setStats(statsR)
 }

 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(() => { void refresh() }, [])

 const loadTree = async (treeId: string) => {
 try {
 const r = await fetch(`/api/objective?action=tree&treeId=${treeId}`)
 if (!r.ok) { toast.error(`Load tree failed: HTTP ${r.status}`); return }
 const d = await r.json()
 setSelectedTree(d)
 } catch (e: any) {
 toast.error(`Load tree failed: ${e.message}`)
 }
 }

 const createTree = async () => {
 if (!rootGoal.trim()) return
 try {
 const r = await fetch('/api/objective', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'create_tree', rootGoal }),
 })
 const d = await r.json()
 if (!r.ok) { toast.error(`Create tree failed: ${d.error || `HTTP ${r.status}`}`); return }
 if (d.ok) {
 toast.success(`Albero creato: ${d.totalNodes} nodi, profondità ${d.maxDepth}`)
 refresh()
 loadTree(d.treeId)
 }
 } catch (e: any) {
 toast.error(`Create tree failed: ${e.message}`)
 }
 }

 const evalNode = async (nodeId: string, status: 'pass' | 'fail' | 'skipped') => {
 try {
 const r = await fetch('/api/objective', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'evaluate_node', nodeId, status }),
 })
 const d = await r.json()
 if (!r.ok) { toast.error(`Evaluate failed: ${d.error || `HTTP ${r.status}`}`); return }
 if (d.ok) {
 toast.success(`Nodo: ${status}`)
 if (selectedTree) loadTree(selectedTree.tree.id)
 refresh()
 }
 } catch (e: any) {
 toast.error(`Evaluate failed: ${e.message}`)
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase12" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
 <StatCard label="Alberi" value={stats.trees} />
 <StatCard label="Nodi" value={stats.nodes} />
 <StatCard label="Completati" value={stats.completedTrees} highlight />
 <StatCard label="Pass" value={stats.passNodes} />
 <StatCard label="Fail" value={stats.failNodes} warn={stats.failNodes > 0} />
 </div>
 )}

 <Tabs defaultValue="create" className="w-full">
 <TabsList className="grid grid-cols-3 w-full">
 <TabsTrigger value="create"><Plus className="size-3.5 mr-1.5" /> Crea Albero</TabsTrigger>
 <TabsTrigger value="graph">Grafo Albero</TabsTrigger>
 <TabsTrigger value="explore">Esplora Alberi</TabsTrigger>
 </TabsList>

 <TabsContent value="create" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Decomponi Obiettivo Macro</CardTitle>
 <CardDescription>
 BFS con branching factor 3, peso dimezzato ad ogni livello, stop se peso &lt; 0.1 o depth &gt;= 5
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <Label className="text-xs">Obiettivo macro</Label>
 <Input value={rootGoal} onChange={(e) => setRootGoal(e.target.value)} />
 </div>
 <Button size="sm" onClick={createTree} disabled={!rootGoal.trim()}>
 <Plus className="size-3.5 mr-1.5" /> Crea Albero BFS
 </Button>
 </CardContent>
 </Card>

 {selectedTree && (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Albero Decomposto</CardTitle>
 <CardDescription>
 {selectedTree.tree.rootGoal} · {selectedTree.nodes.length} nodi · profondità max {selectedTree.tree.maxDepth}
 </CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-96 pr-2">
 <div className="space-y-1">
 {selectedTree.nodes.map((n) => {
 const Icon = STATUS_ICON[n.status] || null
 return (
 <div
 key={n.id}
 className={cn('text-xs border rounded-md p-2', TIER_COLOR[n.contextTier])}
 style={{ marginLeft: `${n.depth * 20}px` }}
 >
 <div className="flex items-center gap-2">
 {Icon && <Icon className={cn('size-3.5 shrink-0', n.status === 'pass' && 'text-status-ok', n.status === 'fail' && 'text-status-danger', n.status === 'skipped' && 'text-muted-foreground')} />}
 <Badge variant="outline" className="text-[9px] font-mono py-0">L{n.depth}</Badge>
 <Badge variant="outline" className="text-[9px] py-0">{n.contextTier}</Badge>
 <span className="text-[10px] font-mono text-muted-foreground">w={n.weight.toFixed(3)}</span>
 <span className="flex-1 truncate">{n.description}</span>
 {n.status === 'pending' && (
 <div className="flex gap-1">
 <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] bg-status-ok hover:bg-status-ok/20 " onClick={() => evalNode(n.id, 'pass')}>Pass</Button>
 <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] bg-status-danger hover:bg-status-danger/20 text-status-danger" onClick={() => evalNode(n.id, 'fail')}>Fail</Button>
 </div>
 )}
 {n.status !== 'pending' && (
 <Badge variant="secondary" className="text-[9px] py-0">{n.status}</Badge>
 )}
 </div>
 </div>
 )
 })}
 </div>
 </ScrollArea>
 </CardContent>
 </Card>
 )}
 </TabsContent>

 <TabsContent value="graph" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Grafo Albero Obiettivi</CardTitle>
 <CardDescription>Visualizzazione React Flow gerarchica con context tier e status Pass/Fail</CardDescription>
 </CardHeader>
 <CardContent>
 {selectedTree ? (
 <ObjectiveTreeVisualizer nodes={selectedTree.nodes} />
 ) : (
 <div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
 Crea o seleziona un albero per visualizzare il grafo gerarchico interattivo.
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="explore" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Alberi Esistenti</CardTitle>
 <CardDescription>{trees.length} alberi totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-80 pr-2">
 {trees.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessun albero. Creane uno dal tab "Crea Albero".</p>
 ) : (
 <ul className="space-y-1.5">
 {trees.map((t) => (
 <li key={t.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border">
 <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
 <Badge variant="secondary" className="text-[10px]">{t.totalNodes} nodi</Badge>
 <Badge variant="outline" className="text-[10px]">L{t.maxDepth}</Badge>
 <span className="flex-1 truncate">{t.rootGoal}</span>
 <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" onClick={() => loadTree(t.id)}>
 Esplora
 </Button>
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 <RelatedPhases links={[link('phase2', 'Piano da obiettivo', 'La rubric tree guida la generazione del piano DynAMO'), link('phase5', 'Euristiche di valutazione', 'I nodi Pass/Fail usano euristiche ERL'), link('phase7', 'Tracce di valutazione', 'Le esecuzioni validate producono tracce per PTA'), link('phase8', 'Verifica formale', 'I nodi foglia possono avere contratti Lean4')]} />

 </div>
 )
}

function StatCard({ label, value, highlight, warn }: { label: string; value: number | string; highlight?: boolean; warn?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4">
 <div className="text-muted-foreground text-xs mb-1">{label}</div>
 <div className={cn('text-2xl font-bold font-mono', highlight && 'text-status-ok', warn && 'text-status-warn')}>{value}</div>
 </CardContent>
 </Card>
 )
}
