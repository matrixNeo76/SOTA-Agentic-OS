import { cn } from '@/lib/utils'
export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, className }: { icon: React.ComponentType<{ className?: string }>; title: string; description?: string; actionLabel?: string; onAction?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      <Icon className="size-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm">{description}</p>}
      {actionLabel && onAction && <button onClick={onAction} className="mt-4 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">{actionLabel}</button>}
    </div>
  )
}
