'use client'

import { useStore, PHASES, CATEGORY_COLORS, type Phase } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { ARCHITECTURE_FLOWS } from './related-phases'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Mappa architetturale cliccabile: mostra le 14 fasi organizzate per categoria
 * e i 6 flussi end-to-end che le collegano.
 *
 * Layout: 7 colonne (una per categoria), ogni fase è un nodo cliccabile.
 * I flussi sono rappresentati come linee colorate sovrapposte.
 */
export function ArchitectureMap() {
  const { setActivePhase, activePhase } = useStore()

  // Raggruppa per categoria
  const categories = PHASES.reduce((acc, p) => {
    const cat = p.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(p)
    return acc
  }, {} as Record<string, typeof PHASES>)

  const catOrder = ['foundation', 'orchestration', 'cognitive', 'trust', 'learning', 'governance', 'infrastructure']
  const catLabels: Record<string, string> = {
    foundation: 'Foundation',
    orchestration: 'Orchestration',
    cognitive: 'Cognitive',
    trust: 'Trust',
    learning: 'Learning',
    governance: 'Governance',
    infrastructure: 'Infrastructure',
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm">Mappa Architetturale</CardTitle>
            <CardDescription className="text-xs">
              14 fasi organizzate per categoria · clicca per navigare
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ARCHITECTURE_FLOWS.map((flow) => (
              <Badge
                key={flow.name}
                variant="outline"
                className="text-[9px] gap-1 py-0"
                style={{ borderColor: flow.color }}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: flow.color }} />
                {flow.name}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {catOrder.map((cat) => {
            const phases = categories[cat] || []
            return (
              <div key={cat} className="space-y-1.5">
                <div className={cn(
                  'text-[9px] font-bold uppercase tracking-wider text-center pb-1 border-b',
                  CATEGORY_COLORS[cat]
                )}>
                  {catLabels[cat]}
                </div>
                {phases.map((p) => {
                  const Icon = getIcon(p.icon)
                  const active = activePhase === p.id
                  // Determina quali flussi attraversano questa fase
                  const flowsHere = ARCHITECTURE_FLOWS.filter(f => f.phases.includes(p.id))
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActivePhase(p.id as Phase)}
                      className={cn(
                        'w-full rounded-md p-2 text-left border transition-all hover:scale-[1.02] hover:shadow-sm',
                        active
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-border bg-card hover:border-primary/40'
                      )}
                      title={`${p.name} (Fase ${p.number})`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className={cn('size-3 shrink-0', CATEGORY_COLORS[cat])} />
                        <span className="text-[10px] font-mono text-muted-foreground">F{p.number}</span>
                      </div>
                      <div className="text-[11px] font-medium leading-tight mb-0.5">{p.name}</div>
                      <div className="text-[9px] text-muted-foreground line-clamp-1">{p.subtitle}</div>
                      {flowsHere.length > 0 && (
                        <div className="flex gap-0.5 mt-1.5">
                          {flowsHere.map((f) => (
                            <span
                              key={f.name}
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: f.color }}
                              title={f.name}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
