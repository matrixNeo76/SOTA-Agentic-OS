import { cn } from '@/lib/utils'
import { RefreshCw, Loader2 } from 'lucide-react'
export function RefreshButton({ onClick, loading = false, label = 'Aggiorna', size = 'sm', className }: { onClick: () => void; loading?: boolean; label?: string; size?: 'sm' | 'md'; className?: string }) {
 return (
 <button onClick={onClick} disabled={loading} className={cn('inline-flex items-center gap-1.5 rounded-md border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50', size === 'sm' ? 'h-8 px-3' : 'h-9 px-4', className)}>
 {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
 <span className="hidden sm:inline">{label}</span>
 </button>
 )
}
