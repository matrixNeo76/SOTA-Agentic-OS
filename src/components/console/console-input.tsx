'use client'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUp, Square, Sparkles, Search, X, Cpu, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useConsoleAttachments } from './use-console-attachments'
import type { Skill } from './types'

type SS = Pick<Skill, 'id' | 'name' | 'description' | 'promptTemplate'>

type ModelOption = { modelId: string; name: string; specialization: string }
type ToolOption = { toolId: string; name: string }

export function ConsoleInput(props: {
  input: string
  setInput: (v: string) => void
  executing: boolean
  onSend: (t: string) => void
  onStop: () => void
  onPlanOnly: (t: string) => void
  skills: SS[]
  // UX Architecture: per-run model/tool selection
  modelId?: string
  setModelId?: (id: string | undefined) => void
  allowedTools?: string[]
  setAllowedTools?: (tools: string[] | undefined) => void
}) {
  const { input, setInput, executing, onSend, onStop, onPlanOnly, skills } = props
  const ir = useRef<HTMLTextAreaElement>(null)
  const [showSkill, setShowSkill] = useState(false)
  const [skillSearch, setSkillSearch] = useState('')
  const [showModel, setShowModel] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [tools, setTools] = useState<ToolOption[]>([])
  const focusInput = () => ir.current?.focus()
  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useConsoleAttachments(input, setInput, focusInput)

  useEffect(() => { if (ir.current) { ir.current.style.height = 'auto'; ir.current.style.height = Math.min(ir.current.scrollHeight, 120) + 'px' } }, [input])

  // UX Architecture: fetch models and tools on mount
  useEffect(() => {
    fetch('/api/router?action=models').then(r => r.json()).then(d => setModels(d.models || [])).catch(() => {})
    fetch('/api/tools').then(r => r.json()).then(d => setTools((d.tools || []).map((t: any) => ({ toolId: t.toolId, name: t.name })))).catch(() => {})
  }, [])

  const filtered = skills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase()))
  const applySkill = (s: SS) => { setInput(s.promptTemplate); setShowSkill(false); setSkillSearch(''); toast.success(`Skill "${s.name}" caricata`); setTimeout(focusInput, 0) }

  const toggleTool = (toolId: string) => {
    const current = props.allowedTools || []
    const next = current.includes(toolId) ? current.filter(t => t !== toolId) : [...current, toolId]
    props.setAllowedTools?.(next.length > 0 ? next : undefined)
  }

  const modelLabel = props.modelId ? models.find(m => m.modelId === props.modelId)?.name || props.modelId : 'Auto'
  const toolsLabel = props.allowedTools && props.allowedTools.length > 0 ? `${props.allowedTools.length}` : 'All'

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
 <div className="flex items-center justify-between mt-1 px-1">
   <div className="flex items-center gap-1.5">
     <p className="text-[10px] text-muted-foreground hidden sm:block">Invio per eseguire · Shift+Invio nuova riga{executing ? ' · ■ per interrompere' : ''}</p>
   </div>
   <div className="flex items-center gap-1">
     {/* UX Architecture: Model picker */}
     {models.length > 0 && (
       <button onClick={() => { setShowModel(!showModel); setShowTools(false) }} className={cn('flex items-center gap-1 text-[10px] px-2 h-6 rounded-md hover:bg-muted transition-colors', props.modelId && 'bg-primary/10 text-primary')} aria-label="Model picker">
         <Cpu className="size-3" /> {modelLabel}
       </button>
     )}
     {/* UX Architecture: Tool picker */}
     {tools.length > 0 && (
       <button onClick={() => { setShowTools(!showTools); setShowModel(false) }} className={cn('flex items-center gap-1 text-[10px] px-2 h-6 rounded-md hover:bg-muted transition-colors', props.allowedTools && props.allowedTools.length > 0 && 'bg-primary/10 text-primary')} aria-label="Tool picker">
         <Wrench className="size-3" /> {toolsLabel}
       </button>
     )}
     <button onClick={() => onPlanOnly(input)} disabled={executing} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">Solo piano</button>
   </div>
 </div>
 {/* Model picker popover */}
 {showModel && (
   <div className="mt-1 rounded-lg border bg-popover shadow-lg p-2 max-h-60 overflow-y-auto">
     <div className="flex items-center gap-2 mb-2"><Cpu className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">Seleziona modello</span><button onClick={() => setShowModel(false)} className="ml-auto text-muted-foreground"><X className="size-3.5" /></button></div>
     <button onClick={() => { props.setModelId?.(undefined); setShowModel(false) }} className={cn('w-full text-left p-2 rounded text-xs hover:bg-muted transition-colors', !props.modelId && 'bg-primary/10 text-primary')}>Auto (TimeRouter sceglie)</button>
     {models.map(m => <button key={m.modelId} onClick={() => { props.setModelId?.(m.modelId); setShowModel(false) }} className={cn('w-full text-left p-2 rounded text-xs hover:bg-muted transition-colors', props.modelId === m.modelId && 'bg-primary/10 text-primary')}>{m.name} <span className="text-muted-foreground text-[10px]">({m.specialization})</span></button>)}
   </div>
 )}
 {/* Tool picker popover */}
 {showTools && (
   <div className="mt-1 rounded-lg border bg-popover shadow-lg p-2 max-h-60 overflow-y-auto">
     <div className="flex items-center gap-2 mb-2"><Wrench className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">Seleziona tool ({props.allowedTools?.length || 0} selezionati)</span><button onClick={() => setShowTools(false)} className="ml-auto text-muted-foreground"><X className="size-3.5" /></button></div>
     <button onClick={() => { props.setAllowedTools?.(undefined) }} className={cn('w-full text-left p-2 rounded text-xs hover:bg-muted transition-colors', !props.allowedTools && 'bg-primary/10 text-primary')}>Tutti i tool (default)</button>
     {tools.map(t => <label key={t.toolId} className="flex items-center gap-2 p-2 rounded text-xs hover:bg-muted transition-colors cursor-pointer"><input type="checkbox" checked={props.allowedTools?.includes(t.toolId) || false} onChange={() => toggleTool(t.toolId)} className="accent-primary" />{t.name}<span className="text-muted-foreground text-[10px] ml-auto">{t.toolId}</span></label>)}
   </div>
 )}
 </div>
 </div>
 )
}
