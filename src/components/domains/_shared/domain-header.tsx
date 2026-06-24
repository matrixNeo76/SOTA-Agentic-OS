'use client'
import { cn } from '@/lib/utils'
export function DomainHeader({ title, subtitle, domain, action }: { title: string; subtitle: string; domain: 'inspect' | 'ecosystem'; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 pb-4 border-b"><div><div className={cn('text-[10px] font-semibold uppercase tracking-wider mb-1', domain === 'inspect' ? 'text-cat-cognitive' : 'text-cat-orchestration')}>{domain === 'inspect' ? 'Inspect' : 'Ecosystem'}</div><h1 className="text-lg font-semibold tracking-tight">{title}</h1><p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p></div>{action}</div>
}
