'use client'

import { useSensoriumLive } from './use-sensorium-live'
import { Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LiveFeed() {
 const { connected, events } = useSensoriumLive()

 return (
 <div>
 <div className="flex items-center gap-2 mb-3">
 <Radio className={cn('size-3.5', connected ? 'text-status-ok' : 'text-muted-foreground')} />
 <span className="text-xs font-medium text-muted-foreground">
 {connected ? 'Live Events' : 'Disconnesso'}
 </span>
 </div>

 {events.length === 0 ? (
 <p className="text-xs text-muted-foreground italic py-4">
 In attesa di eventi…
 </p>
 ) : (
 <div className="space-y-1 max-h-48 overflow-y-auto">
 {events.slice(0, 15).map((e, i) => (
 <div key={i} className="flex items-center gap-2 text-xs py-1">
 <span className={cn(
 'size-1.5 rounded-full shrink-0',
 e.level === 'warn' || e.level === 'error' ? 'bg-status-warn' : 'bg-status-ok'
 )} />
 <span className="text-muted-foreground font-mono text-[10px] shrink-0">P{e.phase}</span>
 <span className="font-mono text-[10px] shrink-0 text-muted-foreground">{e.agentId}</span>
 <span className="font-mono text-[11px] truncate">{e.event}</span>
 <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
 {new Date(e.ts).toLocaleTimeString('it-IT')}
 </span>
 </div>
 ))}
 </div>
 )}
 </div>
 )
}
