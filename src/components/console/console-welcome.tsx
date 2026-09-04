'use client'
import { SUGGESTIONS } from './types'
import { Brain, Shield, Zap, Terminal, Sparkles, Target, Code2, Bug, Search, Rocket, FileText } from 'lucide-react'

const SIC: Record<string, typeof Brain> = { brain: Brain, shield: Shield, zap: Zap, terminal: Terminal }

const TEMPLATES = [
  { icon: Code2, title: 'Code Review', desc: 'Analizza codice, trova bug, suggerisci refactoring', prompt: 'Analizza il codice del modulo di autenticazione e identifica potenziali vulnerabilità di sicurezza, bug logici e opportunità di refactoring' },
  { icon: Bug, title: 'Bug Triage', desc: 'Riproduci e diagnostica un bug', prompt: 'Riproponi il bug "login fallisce su Safari con cookies di terze parti bloccati", diagnosticane la causa e proponi una fix' },
  { icon: Search, title: 'Research Brief', desc: 'Ricerca approfondita e sintesi', prompt: 'Ricerca le best practice per implementare rate limiting in un API gateway e produci un report strutturato con raccomandazioni' },
  { icon: Rocket, title: 'Deploy Plan', desc: 'Pianifica un deployment sicuro', prompt: 'Pianifica il deploy del microservizio auth v2.0 in produzione con zero downtime, includendo rollback strategy e smoke tests' },
  { icon: FileText, title: 'Documentation', desc: 'Genera documentazione da codice', prompt: 'Genera la documentazione API per tutti gli endpoint del modulo /api/console, includendo esempi di request/response' },
  { icon: Target, title: 'Pianifica un task', desc: 'Descrivi cosa vuoi ottenere', prompt: 'Pianifica la migrazione di un API REST da v1 a v2 con zero downtime' },
]

export function ConsoleWelcome({ onSuggestion }: { onSuggestion: (s: string) => void }) {
 return (
 <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8">
 <div className="max-w-2xl w-full text-center space-y-6">
 <div className="size-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center"><Sparkles className="size-7 text-primary" /></div>
 <div><h2 className="text-2xl font-semibold tracking-tight">Ciao, sono SOTA</h2><p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">Posso pianificare, eseguire, verificare e imparare.</p></div>

 {/* Template grid */}
 <div className="text-left">
   <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 text-center">Template pronti all'uso</div>
   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
     {TEMPLATES.map(t => {
       const Icon = t.icon
       return (
         <button key={t.title} onClick={() => onSuggestion(t.prompt)} className="text-left p-3 rounded-lg border hover:border-primary/30 hover:bg-muted/30 hover:shadow-sm transition-all group flex items-start gap-3">
           <div className="size-8 rounded-lg bg-primary/8 group-hover:bg-primary/12 flex items-center justify-center shrink-0 transition-colors"><Icon className="size-4 text-primary" /></div>
           <div className="min-w-0"><div className="text-xs font-semibold">{t.title}</div><div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{t.desc}</div></div>
         </button>
       )
     })}
   </div>
 </div>

 {/* Quick suggestions */}
 <div className="text-left">
   <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 text-center">Suggerimenti rapidi</div>
   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
     {SUGGESTIONS.map(s => {
       const Icon = SIC[s.icon] || Terminal
       return (
         <button key={s.title} onClick={() => onSuggestion(s.desc)} className="text-left p-2.5 rounded-md border hover:border-primary/30 hover:bg-muted/30 transition-all group flex items-start gap-2.5">
           <div className="size-7 rounded-md bg-muted/50 group-hover:bg-primary/8 flex items-center justify-center shrink-0 transition-colors"><Icon className="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" /></div>
           <div className="min-w-0"><div className="text-xs font-medium">{s.title}</div><div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{s.desc}</div></div>
         </button>
       )
     })}
   </div>
 </div>
 </div>
 </div>
 )
}
