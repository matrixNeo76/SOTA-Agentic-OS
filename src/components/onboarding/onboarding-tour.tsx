'use client'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Sparkles, Terminal, Command, ShieldAlert, Compass, X, ChevronRight, CheckCircle2 } from 'lucide-react'

const STEPS = [
  { id: 'welcome', icon: Sparkles, title: 'Benvenuto in SOTA Agentic OS', description: 'Sei nel posto giusto. SOTA è un sistema operativo per agenti autonomi: pianifica, esegue, verifica e impara. Iniziamo con un tour di 30 secondi.' },
  { id: 'console', icon: Terminal, title: 'Console — il punto di partenza', description: 'Scrivi un task in linguaggio naturale. SOTA genera un piano DynAMO, lo esegue passo-passo con steering cognitivo, verifica LTL safety, e impara dall\'esperienza.' },
  { id: 'command-palette', icon: Command, title: 'Cmd+K — accedi a tutto', description: 'Premi Cmd+K (o Ctrl+K) ovunque per aprire la command palette. Cerca azioni, fasi, tool. È il modo più veloce per navigare.' },
  { id: 'sovereign', icon: ShieldAlert, title: 'Sovereign — approvazioni', description: 'Quando un\'azione richiede approvazione umana (irreversibile, alta sicurezza), appare un modale. Puoi snoozare o dismiss per la sessione. Il badge rosso ti ricorda le azioni pending.' },
  { id: 'inspect', icon: Compass, title: 'Inspect — configurazione avanzata', description: 'Per configurare fasi specifiche (memoria, planning, verifica, learning), vai in Inspect nella sidebar. Ma non serve per iniziare — la Console basta per il 90% delle attività.' },
]

const STORAGE_KEY = 'onboarding_completed'

export function OnboardingTour() {
  const [visible, setVisible] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const status = localStorage.getItem(STORAGE_KEY)
    if (!status) { const t = setTimeout(() => setVisible(true), 1000); return () => clearTimeout(t) }
  }, [])

  if (!visible) return null
  const step = STEPS[stepIdx]
  const Icon = step.icon
  const isLast = stepIdx === STEPS.length - 1

  const complete = (status: 'completed' | 'skipped') => {
    try { localStorage.setItem(STORAGE_KEY, status) } catch {}
    setVisible(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl">
        <button onClick={() => complete('skipped')} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"><X className="size-4" /></button>
        <div className="flex items-center gap-1.5 mb-4">{STEPS.map((s, i) => (<div key={s.id} className={cn('h-1 rounded-full transition-all', i === stepIdx ? 'w-6 bg-primary' : i < stepIdx ? 'w-2 bg-primary/60' : 'w-2 bg-muted')} />))}</div>
        <div className="flex items-center gap-3 mb-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Icon className="size-5 text-primary" /></div>
          <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step {stepIdx + 1} di {STEPS.length}</div><h3 className="text-base font-semibold leading-tight">{step.title}</h3></div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">{step.description}</p>
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => complete('skipped')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Salta il tour</button>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && <button onClick={() => setStepIdx(prev => prev - 1)} className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">Indietro</button>}
            <button onClick={() => isLast ? complete('completed') : setStepIdx(prev => prev + 1)} className={cn('h-8 px-4 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95', isLast ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-primary text-primary-foreground hover:opacity-90')}>{isLast ? <><CheckCircle2 className="size-3.5" />Completa</> : <>Avanti<ChevronRight className="size-3.5" /></>}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function restartTour() { try { localStorage.removeItem(STORAGE_KEY); if (typeof window !== 'undefined') window.location.reload() } catch {} }
export function isOnboardingCompleted(): boolean { if (typeof window === 'undefined') return true; return localStorage.getItem(STORAGE_KEY) !== null }
