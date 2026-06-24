'use client'
import { SUGGESTIONS } from './types'
import { Brain, Shield, Zap, Terminal, Sparkles, Target } from 'lucide-react'

const SIC: Record<string, typeof Brain> = { brain: Brain, shield: Shield, zap: Zap, terminal: Terminal }
const CAPS = [
  { icon: Sparkles, title: 'Pianifica un task', desc: 'Descrivi cosa vuoi ottenere. SOTA genera un piano DynAMO e lo esegue passo-passo.', prompt: 'Pianifica la migrazione di un API REST da v1 a v2 con zero downtime' },
  { icon: Shield, title: 'Verifica una regola LTL', desc: 'Definisci una regola di safety e verifica che un evento la rispetti.', prompt: 'Verifica che l azione cancella utente rispetti la regola LTL mai senza conferma umana' },
  { icon: Target, title: 'Analizza codice', desc: 'Invia un frammento di codice per revisione di sicurezza e performance.', prompt: 'Analizza questo codice per vulnerabilita: la funzione login esegue una query SQL concatenando direttamente l input utente' },
]

export function ConsoleWelcome({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="max-w-2xl w-full text-center space-y-6">
        <div className="size-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center"><Sparkles className="size-7 text-primary" /></div>
        <div><h2 className="text-2xl font-semibold tracking-tight">Ciao, sono SOTA</h2><p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">Posso pianificare, eseguire, verificare e imparare.</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
          {CAPS.map(c => { const Icon = c.icon; return (
            <button key={c.title} onClick={() => onSuggestion(c.prompt)} className="text-left p-4 rounded-lg border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all group">
              <div className="size-9 rounded-lg bg-primary/8 group-hover:bg-primary/12 flex items-center justify-center mb-2 transition-colors"><Icon className="size-4 text-primary" /></div>
              <div className="text-sm font-semibold">{c.title}</div><div className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{c.desc}</div>
            </button>) })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
          {SUGGESTIONS.map(s => { const Icon = SIC[s.icon] || Terminal; return (
            <button key={s.title} onClick={() => onSuggestion(s.desc)} className="text-left p-2.5 rounded-md border hover:border-primary/30 hover:bg-muted/30 transition-all group flex items-start gap-2.5">
              <div className="size-7 rounded-md bg-muted/50 group-hover:bg-primary/8 flex items-center justify-center shrink-0 transition-colors"><Icon className="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" /></div>
              <div className="min-w-0"><div className="text-xs font-medium">{s.title}</div><div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{s.desc}</div></div>
            </button>) })}
        </div>
      </div>
    </div>
  )
}
