'use client'

/**
 * Onboarding Tour — UX-6a
 *
 * Tour 5-step rivisto sulle 6 aree della nuova IA (non più sulle fasi).
 * Si attiva al primo accesso (localStorage flag 'sota_onboarded_v2').
 *
 * Steps:
 *   1. Dashboard — Overview del sistema
 *   2. Runs — Esegui workflow e osserva l'esecuzione step-by-step
 *   3. Memory & Knowledge — Esplora il Context Graph e cerca nella memoria
 *   4. Agents & Org — Mesh di agenti, skills, proposte autonome
 *   5. Trust & Governance — HITL, conflitti, audit
 */

import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { X, ChevronRight, ChevronLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TourStep {
  area: string
  title: string
  description: string
  icon: string
  tips: string[]
}

const TOUR_STEPS: TourStep[] = [
  {
    area: 'dashboard',
    title: 'Dashboard',
    description: 'Il centro di controllo del tuo OS agentico',
    icon: 'LayoutDashboard',
    tips: [
      'Monitora KPI globali: costi, task, agenti attivi',
      'Vedi l\'activity feed in tempo reale',
      'Accedi rapidamente a qualsiasi area da qui',
    ],
  },
  {
    area: 'runs',
    title: 'Runs — Esecuzione',
    description: 'Crea ed esegui workflow autonomi',
    icon: 'Play',
    tips: [
      'Scrivi un task in linguaggio naturale',
      'Il sistema genera un piano DynAMO e lo esegue step-by-step',
      'Osserva il loop ReAct: pensiero → tool call → osservazione',
      'I workflow sono durevoli: riprendono dopo un crash',
    ],
  },
  {
    area: 'memory',
    title: 'Memory & Knowledge',
    description: 'Il cervello del sistema',
    icon: 'Database',
    tips: [
      'Context Graph: tutti gli agenti, task, decisioni come nodi collegati',
      'Ricerca semantica nella memoria (4 layer: episodic, semantic, procedural, reasoning)',
      'Knowledge Extraction: trasforma documenti in conoscenza',
    ],
  },
  {
    area: 'agents',
    title: 'Agents & Organization',
    description: 'La tua organizzazione autonoma',
    icon: 'Users',
    tips: [
      'Mesh gerarchica: CEO → Strategic → Operational (10 agenti)',
      'Skill Registry: catalogo di capacità riutilizzabili',
      'Autonomous Org: il sistema propone azioni, tu approvi (HITL)',
    ],
  },
  {
    area: 'governance',
    title: 'Trust & Governance',
    description: 'Safety, verifica, controllo umano',
    icon: 'ShieldCheck',
    tips: [
      'Azioni bloccate dal LTL monitor richiedono la tua approvazione',
      'Risolvi conflitti tra claim di conoscenza',
      'Audit trail completo di ogni decisione',
    ],
  },
]

export function OnboardingTourV2() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const { setActivePhase } = useStore()

  useEffect(() => {
    const onboarded = localStorage.getItem('sota_onboarded_v2')
    if (!onboarded) setVisible(true)
  }, [])

  const dismiss = () => {
    localStorage.setItem('sota_onboarded_v2', 'true')
    setVisible(false)
  }

  const next = () => {
    if (step < TOUR_STEPS.length - 1) {
      const nextStep = step + 1
      setStep(nextStep)
      setActivePhase(TOUR_STEPS[nextStep]!.area as any)
    } else {
      dismiss()
    }
  }

  const prev = () => {
    if (step > 0) {
      const prevStep = step - 1
      setStep(prevStep)
      setActivePhase(TOUR_STEPS[prevStep]!.area as any)
    }
  }

  if (!visible) return null

  const current = TOUR_STEPS[step]!
  const isLast = step === TOUR_STEPS.length - 1

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* Tour card */}
      <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]">
        <Card className="shadow-soft-lg glass">
          <div className="p-5 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <DynamicIcon name={current.icon} className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">{current.title}</h3>
                  <p className="text-xs text-muted-foreground">{current.description}</p>
                </div>
              </div>
              <button
                onClick={dismiss}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close tour"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tips */}
            <ul className="space-y-1.5">
              {current.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground animate-stagger" style={{ animationDelay: `${i * 50}ms` }}>
                  <Check className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>

            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5 py-1">
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                  )}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Skip tour
              </Button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="outline" size="sm" onClick={prev}>
                    <ChevronLeft className="w-3 h-3 mr-0.5" /> Back
                  </Button>
                )}
                <Button size="sm" onClick={next}>
                  {isLast ? 'Get started' : 'Next'}
                  {!isLast && <ChevronRight className="w-3 h-3 ml-0.5" />}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
