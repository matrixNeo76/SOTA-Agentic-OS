import { cn } from '@/lib/utils'
export type KVPair = { label: string; value: React.ReactNode; mono?: boolean; highlight?: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }
const HC: Record<string, string> = { ok: 'text-status-ok', warn: 'text-status-warn', danger: 'text-status-danger', info: 'text-status-info', muted: 'text-muted-foreground' }
export function KVList({ items, className, columns = 1 }: { items: KVPair[]; className?: string; columns?: 1 | 2 | 3 }) {
 return <dl className={cn('grid gap-2', columns === 2 && 'grid-cols-2', columns === 3 && 'grid-cols-3', className)}>{items.map((item, idx) => (<div key={idx} className="bg-muted/30 rounded-md p-2"><dt className="text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">{item.label}</dt><dd className={cn('text-sm font-medium', item.mono && 'font-mono', item.highlight && HC[item.highlight])}>{item.value}</dd></div>))}</dl>
}
