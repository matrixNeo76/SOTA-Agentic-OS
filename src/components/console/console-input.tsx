'use client'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUp, Square, Sparkles, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { useConsoleAttachments } from './use-console-attachments'
import type { Skill } from './types'

type SS = Pick<Skill, 'id' | 'name' | 'description' | 'promptTemplate'>

export function ConsoleInput({ input, setInput, executing, onSend, onStop, onPlanOnly, skills }: { input: string; setInput: (v: string) => void; executing: boolean; onSend: (t: string) => void; onStop: () => void; onPlanOnly: (t: string) => void; skills: SS[] }) {
 const ir = useRef<HTMLTextAreaElement>(null)
 const [showSkill, setShowSkill] = useState(false)
 const [skillSearch, setSkillSearch] = useState('')
 const focusInput = () => ir.current?.focus()
 const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useConsoleAttachments(input, setInput, focusInput)

 useEffect(() => { if (ir.current) { ir.current.style.height = 'auto'; ir.current.style.height = Math.min(ir.current.scrollHeight, 120) + 'px' } }, [input])

 const filtered = skills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase()))
 const applySkill = (s: SS) => { setInput(s.promptTemplate); setShowSkill(false); setSkillSearch(''); toast.success(`Skill "${s.name}" caricata`); setTimeout(focusInput, 0) }

 return (
 <div className="border-t bg-background/95 backdrop-blur shrink-0">
 <div className="max-w-3xl mx-auto p-2 sm:p-3">
 <div className={cn('flex items-end gap-2 rounded-xl border bg-card shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all', isDragging && 'ring-2 ring-primary/40 border-primary/40 bg-primary/5')} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
 {isDragging && <div className="absolute inset-0 pointer-events-none flex items-center justify-center rounded-xl bg-primary/10 border-2 border-dashed border-primary/40"><p className="text-xs font-medium text-primary">Rilascia i file</p></div>}
 <button onClick={() => setShowSkill(!showSkill)} className={cn('size-9 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors shrink-0', showSkill && 'bg-primary/10 text-primary')} aria-label="Skill picker"><Sparkles className="size-4" /></button>
 <textarea ref={ir} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(input) } }} placeholder="Descrivi il task…" rows={1} className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 py-2 px-1 min-w-0" />
 <button onClick={() => executing ? onStop() : onSend(input)} className={cn('size-9 rounded-lg flex items-center justify-center shrink-0 transition-all active:scale-95', executing ? 'bg-destructive text-white hover:bg-destructive/90' : input.trim() ? 'bg-primary text-primary-foreground hover:opacity-90' : 'bg-muted text-muted-foreground')} title={executing ? 'Stop' : 'Send'}>{executing ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}</button>
 </div>
 {showSkill && (<div className="mt-2 rounded-lg border bg-popover shadow-lg p-3 max-h-80 overflow-y-auto"><div className="flex items-center gap-2 mb-2"><Search className="size-3.5 text-muted-foreground" /><input value={skillSearch} onChange={e => setSkillSearch(e.target.value)} placeholder="Cerca skill…" className="flex-1 bg-transparent text-sm outline-none" autoFocus /><button onClick={() => { setShowSkill(false); setSkillSearch('') }} className="text-muted-foreground"><X className="size-4" /></button></div>{filtered.length === 0 ? <p className="text-xs text-muted-foreground italic py-4 text-center">{skills.length === 0 ? 'Nessuna skill disponibile.' : 'Nessun risultato.'}</p> : <div className="space-y-0.5">{filtered.slice(0, 8).map(s => <button key={s.id} onClick={() => applySkill(s)} className="w-full text-left p-2 rounded-sm hover:bg-muted transition-colors"><div className="flex items-center gap-2"><Sparkles className="size-3 text-primary shrink-0" /><span className="text-xs font-medium">{s.name}</span></div><p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p></button>)}</div>}</div>)}
 <div className="flex items-center justify-between mt-1 px-1"><p className="text-[10px] text-muted-foreground hidden sm:block">Invio per eseguire · Shift+Invio nuova riga{executing ? ' · ■ per interrompere' : ''}</p><button onClick={() => onPlanOnly(input)} disabled={executing} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 ml-auto">Solo piano</button></div>
 </div>
 </div>
 )
}
