'use client'

/**
 * ModulePage — UX-8: Pattern riutilizzabile per pagine modulo
 *
 * Standardizza: header + stat cards + tabella/lista + pannello dettaglio + azioni
 *
 * Usage:
 * <ModulePage
 *   title="Agent Mesh"
 *   description="Hierarchical agent mesh topology"
 *   icon="Users"
 *   stats={[{ label: 'Agents', value: 10 }, { label: 'Edges', value: 15 }]}
 *   actions={<Button>Bootstrap</Button>}
 * >
 *   {content}
 * </ModulePage>
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type ReactNode } from 'react'

export interface StatCardData {
  label: string
  value: string | number
  tone?: 'ok' | 'warn' | 'danger'
  icon?: string
}

export interface ModulePageProps {
  title: string
  description: string
  icon?: string
  stats?: StatCardData[]
  actions?: ReactNode
  onRefresh?: () => void
  loading?: boolean
  children: ReactNode
}

export function ModulePage({ title, description, icon, stats, actions, onRefresh, loading, children }: ModulePageProps) {
  return (
    <div className="space-y-4 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <DynamicIcon name={icon} className="w-5 h-5 text-primary" />
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        children
      )}
    </div>
  )
}

function StatCard({ label, value, tone, icon }: StatCardData) {
  const toneClass = tone === 'ok' ? 'text-green-600' : tone === 'warn' ? 'text-yellow-600' : tone === 'danger' ? 'text-red-600' : ''
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </div>
          {icon && <DynamicIcon name={icon} className="w-5 h-5 text-muted-foreground/50" />}
        </div>
      </CardContent>
    </Card>
  )
}

// === Empty State (UX-6) ===
export function EmptyState({ icon, title, description, action }: {
  icon?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <DynamicIcon name={icon} className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
