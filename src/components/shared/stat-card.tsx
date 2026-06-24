import { cn } from '@/lib/utils'
export type StatTone = 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'primary'
const TC: Record<StatTone, string> = { default: 'text-foreground', ok: 'text-status-ok', warn: 'text-status-warn', danger: 'text-status-danger', info: 'text-status-info', primary: 'text-primary' }
export function StatCard({ label, value, icon: Icon, tone = 'default', className }: { label: string; value: string | number; icon?: React.ComponentType<{ className?: string }>; tone?: StatTone; className?: string }) {
  return <div className={cn('bg-card rounded-lg border shadow-sm hover:shadow-md transition-shadow duration-200 p-4', className)}><div className="flex items-center justify-between mb-2"><span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>{Icon && <Icon className={cn('size-4', TC[tone])} />}</div><div className={cn('text-2xl font-bold font-mono tabular-nums tracking-tight', TC[tone])}>{value}</div></div>
}
export function StatCardGrid({ stats, columns = 3, className }: { stats: Array<{ label: string; value: string | number; icon?: React.ComponentType<{ className?: string }>; tone?: StatTone }>; columns?: 2 | 3 | 4 | 5; className?: string }) {
  const c = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }[columns]; return <div className={cn('grid gap-3', c, className)}>{stats.map((s, i) => <StatCard key={i} {...s} />)}</div>
}
