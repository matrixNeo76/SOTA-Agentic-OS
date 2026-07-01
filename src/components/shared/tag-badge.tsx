import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
export type TagVariant = 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary'
const VC: Record<TagVariant, string> = { default: '', ok: 'border-status-ok/40 bg-status-ok/10 text-status-ok', warn: 'border-status-warn/40 bg-status-warn/10 text-status-warn', danger: 'border-status-danger/40 bg-status-danger/10 text-status-danger', info: 'border-status-info/40 bg-status-info/10 text-status-info', muted: 'border-border bg-muted/30 text-muted-foreground', primary: 'border-primary/40 bg-primary/10 text-primary' }
export function TagBadge({ children, variant = 'default', mono = false, className, title }: { children: React.ReactNode; variant?: TagVariant; mono?: boolean; className?: string; title?: string }) {
 return <Badge variant="outline" title={title} className={cn('text-[10px] py-0', mono && 'font-mono', VC[variant], className)}>{children}</Badge>
}
