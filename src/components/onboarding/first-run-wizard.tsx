'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Sparkles, Code2, Bug, Search, FileText, Users, Rocket,
  ArrowRight, ArrowLeft, Check, Loader2, Terminal,
} from 'lucide-react'

// =====================================================
// First-Run Wizard — sostituisce i tour passivi con setup attivo
// =====================================================

const TEMPLATES = [
  {
    id: 'code-review',
    icon: Code2,
    title: 'Code Review',
    desc: 'Analizza codice, trova bug, suggerisci miglioramenti',
    prompt: 'Analizza il codice del modulo di autenticazione e identifica potenziali vulnerabilità di sicurezza, bug logici e opportunità di refactoring',
    agents: ['orchestrator', 'verifier', 'reflective'],
  },
  {
    id: 'bug-triage',
    icon: Bug,
    title: 'Bug Triage',
    desc: 'Riproduci, diagnosticare e prioritzare bug',
    prompt: 'Riproponi il bug "login fallisce su Safari con cookies di terze parti bloccati", diagnosticane la causa e proponi una fix',
    agents: ['orchestrator', 'controller', 'verifier'],
  },
  {
    id: 'research',
    icon: Search,
    title: 'Research Brief',
    desc: 'Ricerca approfondita e sintesi strutturata',
    prompt: 'Ricerca le best practice per implementare rate limiting in un API gateway e produci un report strutturato con raccomandazioni',
    agents: ['orchestrator', 'curator', 'reflective'],
  },
  {
    id: 'deploy-plan',
    icon: Rocket,
    title: 'Deploy Plan',
    desc: 'Pianifica un deployment sicuro end-to-end',
    prompt: 'Pianifica il deploy del microservizio auth v2.0 in produzione con zero downtime, includendo rollback strategy e smoke tests',
    agents: ['orchestrator', 'controller', 'verifier'],
  },
  {
    id: 'docs',
    icon: FileText,
    title: 'Documentation',
    desc: 'Genera documentazione tecnica da codice',
    prompt: 'Genera la documentazione API per tutti gli endpoint del modulo /api/console, includendo esempi di request/response',
    agents: ['orchestrator', 'curator', 'reflective'],
  },
  {
    id: 'custom',
    icon: Terminal,
    title: 'Custom Task',
    desc: 'Scrivi il tuo task in linguaggio naturale',
    prompt: '',
    agents: ['orchestrator', 'curator', 'controller', 'verifier', 'reflective'],
  },
] as const

const STORAGE_KEY = 'sota_first_run_completed'

export function FirstRunWizard({ onTemplateSelect }: {
  onTemplateSelect?: (prompt: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(false)

  useEffect(() => {
    // Show wizard if first run (no localStorage flag) and user is logged in
    const completed = localStorage.getItem(STORAGE_KEY)
    if (!completed) {
      // Small delay to let page render
      const t = setTimeout(() => setOpen(true), 1500)
      return () => clearTimeout(t)
    }
  }, [])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId)
    setStep(1)
  }

  const handleBootstrap = async () => {
    setBootstrapping(true)
    try {
      const r = await fetch('/api/agent-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap' }),
      })
      const d = await r.json()
      if (r.ok) {
        toast.success(`Agent mesh pronto: ${d.created ?? d.agents ?? 'agenti creati'}`)
      } else {
        toast.error(`Bootstrap fallito: ${d.error || 'errore'}`)
      }
    } catch (e: any) {
      toast.error(`Bootstrap fallito: ${e.message}`)
    } finally {
      setBootstrapping(false)
    }
  }

  const handleFinish = () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    setOpen(false)
    const template = TEMPLATES.find(t => t.id === selectedTemplate)
    if (template && template.prompt) {
      onTemplateSelect?.(template.prompt)
    }
  }

  const handleSkip = () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    setOpen(false)
  }

  const selected = TEMPLATES.find(t => t.id === selectedTemplate)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleSkip(); else setOpen(v) }}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        {/* Step 0: Template selection */}
        {step === 0 && (
          <div className="space-y-6 py-4">
            <div className="text-center space-y-2">
              <div className="size-12 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="size-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold">Benvenuto in SOTA Agentic OS</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Scegli un template per iniziare rapidamente, o scrivi il tuo task personalizzato.
                Il sistema genererà un piano e lo eseguirà automaticamente.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TEMPLATES.map(t => {
                const Icon = t.icon
                const isSelected = selectedTemplate === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTemplateSelect(t.id)}
                    className={cn(
                      'text-left p-4 rounded-lg border transition-all group',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/10'
                        : 'border-border hover:border-primary/30 hover:shadow-sm'
                    )}
                  >
                    <div className="size-8 rounded-lg bg-primary/8 group-hover:bg-primary/12 flex items-center justify-center mb-2 transition-colors">
                      <Icon className="size-4 text-primary" />
                    </div>
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{t.desc}</div>
                    {isSelected && (
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-primary font-medium">
                        <Check className="size-3" /> Selezionato
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button onClick={handleSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Salta setup
              </button>
              <Button
                onClick={() => setStep(selectedTemplate ? 1 : 0)}
                disabled={!selectedTemplate}
                className="gap-1.5"
              >
                Continua <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Agent setup + Review */}
        {step === 1 && (
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Configurazione agenti</h2>
              <p className="text-sm text-muted-foreground">
                SOTA usa agenti specializzati per eseguire il tuo task. Puoi usare quelli predefiniti o crearne di personalizzati.
              </p>
            </div>

            {/* Selected template summary */}
            {selected && (
              <div className="rounded-lg border p-4 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <selected.icon className="size-4 text-primary" />
                  <span className="text-sm font-semibold">{selected.title}</span>
                </div>
                {selected.prompt && (
                  <p className="text-xs text-muted-foreground italic line-clamp-3">
                    "{selected.prompt}"
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {selected.agents.map(a => (
                    <span key={a} className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Bootstrap button */}
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Users className="size-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Bootstrap Agent Mesh</div>
                <div className="text-xs text-muted-foreground">Crea 10 agenti predefiniti (orchestrator, curator, controller, verifier, reflective + 5 specialisti)</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBootstrap}
                disabled={bootstrapping}
              >
                {bootstrapping ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
                {bootstrapping ? 'Bootstrapping...' : 'Bootstrap'}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(0)} className="gap-1">
                <ArrowLeft className="size-4" /> Indietro
              </Button>
              <Button onClick={handleFinish} className="gap-1.5">
                Inizia <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
