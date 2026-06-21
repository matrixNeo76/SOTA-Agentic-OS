'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Terminal, Gauge, ShieldAlert, LayoutDashboard, Database, Workflow, Compass,
  ShieldCheck, Sparkles, Scissors, GitFork, FunctionSquare, UserCog, Boxes,
  HeartPulse, Target, Network, Shuffle, Package, Plus, RefreshCw, Send,
  Ban, CheckCircle2, AlertTriangle, Cpu, Activity, Zap, Command,
} from 'lucide-react'
import type { Phase, WorkspaceView } from '@/lib/store'
import { PHASES } from '@/lib/store'

// === Command types ===
export type CommandCategory = 'actions' | 'phases' | 'tools' | 'views' | 'recent'

export type CommandAction = {
  id: string
  label: string
  description?: string
  icon: LucideIcon
  category: CommandCategory
  keywords?: string[]
  shortcut?: string
  action: () => void
  // Optional: dynamically hide/disable based on system state
  isVisible?: () => boolean
  badge?: number  // e.g. count of pending items
}

// === Registry singleton ===
type Listener = () => void

class CommandRegistry {
  private commands: Map<string, CommandAction> = new Map()
  private listeners: Set<Listener> = new Set()

  register(action: CommandAction) {
    this.commands.set(action.id, action)
    this.notify()
    return () => {
      this.commands.delete(action.id)
      this.notify()
    }
  }

  unregister(id: string) {
    this.commands.delete(id)
    this.notify()
  }

  getAll(): CommandAction[] {
    return Array.from(this.commands.values()).filter(
      (c) => !c.isVisible || c.isVisible()
    )
  }

  getById(id: string): CommandAction | undefined {
    return this.commands.get(id)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }

  clear() {
    this.commands.clear()
    this.notify()
  }
}

export const commandRegistry = new CommandRegistry()

// === Helpers for building static commands ===
// These return CommandAction[] arrays; they get registered by the CommandPalette
// when it mounts. Component-specific actions get registered/unregistered dynamically.

export function buildCoreCommands(
  setActivePhase: (p: Phase) => void,
  setActiveView: (v: WorkspaceView) => void,
  setCommandPaletteOpen: (open: boolean) => void
): CommandAction[] {
  const cmds: CommandAction[] = []

  // === Quick actions ===
  cmds.push({
    id: 'action:new-task',
    label: 'Nuovo task',
    description: 'Apri Console e invia un nuovo task all\'agente',
    icon: Plus,
    category: 'actions',
    keywords: ['nuovo', 'task', 'console', 'chat', 'messaggio', 'prompt'],
    shortcut: 'Cmd+N',
    action: () => {
      setActivePhase('console')
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'action:refresh-dashboard',
    label: 'Aggiorna dashboard',
    description: 'Ricarica le metriche di sistema',
    icon: RefreshCw,
    category: 'actions',
    keywords: ['refresh', 'aggiorna', 'reload', 'metriche'],
    action: () => {
      // Dispatch a global refresh event that dashboard/hooks can listen to
      window.dispatchEvent(new CustomEvent('sota:refresh'))
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'action:execute-plan',
    label: 'Genera piano DynAMO',
    description: 'Apri Planner & Compiler per generare un piano multi-agente',
    icon: Send,
    category: 'actions',
    keywords: ['piano', 'plan', 'dynamo', 'llm', 'orchestrazione'],
    action: () => {
      setActivePhase('phase2')
      setCommandPaletteOpen(false)
    },
  })

  // === Views ===
  cmds.push({
    id: 'view:console',
    label: 'Vai a Console',
    description: 'Workspace conversazionale',
    icon: Terminal,
    category: 'views',
    keywords: ['console', 'chat', 'agent', 'task'],
    action: () => {
      setActiveView('console')
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'view:canvas',
    label: 'Vai a Canvas',
    description: 'DAG visualizer unificato',
    icon: GitFork,
    category: 'views',
    keywords: ['canvas', 'dag', 'graph', 'visualizer'],
    action: () => {
      setActiveView('canvas')
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'view:timeline',
    label: 'Vai a Timeline',
    description: 'Timeline eventi agent',
    icon: Activity,
    category: 'views',
    keywords: ['timeline', 'eventi', 'storico', 'log'],
    action: () => {
      setActiveView('timeline')
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'view:cockpit',
    label: 'Vai a Cockpit',
    description: 'Plancia operativa 5-tab',
    icon: Gauge,
    category: 'views',
    keywords: ['cockpit', 'operazioni', 'real-time'],
    action: () => {
      setActiveView('cockpit')
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'view:sovereign',
    label: 'Vai a Sovereign',
    description: 'Supervisione azioni bloccate',
    icon: ShieldAlert,
    category: 'views',
    keywords: ['sovereign', 'blocked', 'hitl', 'gates', 'approvazione'],
    action: () => {
      setActiveView('sovereign')
      setCommandPaletteOpen(false)
    },
  })

  cmds.push({
    id: 'view:dashboard',
    label: 'Torna alla Dashboard',
    description: 'Overview con mappa architetturale',
    icon: LayoutDashboard,
    category: 'views',
    keywords: ['dashboard', 'overview', 'home'],
    action: () => {
      setActivePhase('overview')
      setCommandPaletteOpen(false)
    },
  })

  return cmds
}

// === Phase commands ===
// One command per phase (14 + tools) — generated from PHASES catalog
const PHASE_ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
  Scissors, GitFork, FunctionSquare, UserCog, Boxes, HeartPulse, Target,
  Network, Shuffle, Gauge, Package, Terminal,
}

export function buildPhaseCommands(
  setActivePhase: (p: Phase) => void,
  setCommandPaletteOpen: (open: boolean) => void
): CommandAction[] {
  return PHASES
    .filter((p) => p.id !== 'overview') // already in views as "Dashboard"
    .map((p) => {
      const icon = PHASE_ICON_MAP[p.icon] || LayoutDashboard
      const prefix = p.number > 0 ? `P${p.number} · ` : ''
      return {
        id: `phase:${p.id}`,
        label: `${prefix}${p.name}`,
        description: p.subtitle,
        icon,
        category: 'phases' as const,
        keywords: [p.name, p.subtitle, p.category, p.id, `p${p.number}`],
        action: () => {
          setActivePhase(p.id)
          setCommandPaletteOpen(false)
        },
      }
    })
}

// === Tool / utility commands ===
export function buildToolCommands(
  setActivePhase: (p: Phase) => void,
  setCommandPaletteOpen: (open: boolean) => void
): CommandAction[] {
  return [
    {
      id: 'tool:install',
      label: 'Installa nuovo tool',
      description: 'Vai al Tool Manager, tab Installa',
      icon: Package,
      category: 'tools',
      keywords: ['installa', 'tool', 'package', 'firma', 'ecdsa'],
      action: () => {
        setActivePhase('tools')
        setCommandPaletteOpen(false)
        // After navigation, switch to "Installa" tab via custom event
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('sota:tool-tab', { detail: 'install' }))
        }, 100)
      },
    },
    {
      id: 'tool:verify-ltl',
      label: 'Verifica regola LTL',
      description: 'Apri Verification & Taint editor LTL',
      icon: ShieldCheck,
      category: 'tools',
      keywords: ['ltl', 'verifica', 'fsm', 'safety', 'rule'],
      action: () => {
        setActivePhase('phase4')
        setCommandPaletteOpen(false)
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('sota:phase4-tab', { detail: 'editor' }))
        }, 100)
      },
    },
    {
      id: 'tool:lean-verify',
      label: 'Verifica workflow Lean4',
      description: 'Apri Formal Verifier',
      icon: FunctionSquare,
      category: 'tools',
      keywords: ['lean4', 'verify', 'formale', 'contratti'],
      action: () => {
        setActivePhase('phase8')
        setCommandPaletteOpen(false)
      },
    },
    {
      id: 'tool:cognitive-step',
      label: 'Esegui step cognitivo',
      description: 'Apri Cognitive Steering e fai uno step ACTS',
      icon: Cpu,
      category: 'tools',
      keywords: ['acts', 'cognitive', 'steering', 'step', 'plan', 'execute', 'check', 'reflect'],
      action: () => {
        setActivePhase('phase3')
        setCommandPaletteOpen(false)
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('sota:phase3-step'))
        }, 100)
      },
    },
    {
      id: 'tool:reflection',
      label: 'Rifletti su operazione',
      description: 'Apri Reflective Learning per estrarre euristica',
      icon: Sparkles,
      category: 'tools',
      keywords: ['reflection', 'erl', 'euristica', 'learning', 'red line'],
      action: () => {
        setActivePhase('phase5')
        setCommandPaletteOpen(false)
      },
    },
    {
      id: 'tool:route-prompt',
      label: 'Route prompt',
      description: 'Apri Model Router per analizzare un prompt',
      icon: Shuffle,
      category: 'tools',
      keywords: ['router', 'model', 'route', 'ensemble', 'critic', 'primary'],
      action: () => {
        setActivePhase('phase14')
        setCommandPaletteOpen(false)
      },
    },
  ]
}

// === Quick utility actions ===
export function buildUtilityCommands(
  setCommandPaletteOpen: (open: boolean) => void
): CommandAction[] {
  return [
    {
      id: 'util:toggle-theme',
      label: 'Cambia tema',
      description: 'Switch tra light e dark mode',
      icon: Zap,
      category: 'actions',
      keywords: ['tema', 'theme', 'dark', 'light', 'mode'],
      action: () => {
        // Use next-themes via document class toggle (simpler than wiring context)
        document.documentElement.classList.toggle('dark')
        setCommandPaletteOpen(false)
      },
    },
    {
      id: 'util:help',
      label: 'Mostra shortcuts',
      description: 'Lista delle scorciatoie da tastiera',
      icon: Command,
      category: 'actions',
      keywords: ['help', 'aiuto', 'shortcut', 'tastiera', 'keyboard'],
      action: () => {
        window.dispatchEvent(new CustomEvent('sota:show-shortcuts'))
        setCommandPaletteOpen(false)
      },
    },
  ]
}

// === Search/sort helpers ===
export function fuzzyMatch(query: string, command: CommandAction): number {
  if (!query) return 1
  const q = query.toLowerCase().trim()
  if (!q) return 1

  const haystack = [
    command.label,
    command.description || '',
    ...(command.keywords || []),
    command.id,
  ].join(' ').toLowerCase()

  // Exact match on label = highest priority
  if (command.label.toLowerCase() === q) return 1000
  if (command.label.toLowerCase().startsWith(q)) return 500

  // Word-boundary match in any field
  const words = q.split(/\s+/)
  const allWordsMatch = words.every((w) => haystack.includes(w))
  if (allWordsMatch) return 300

  // Substring match
  if (haystack.includes(q)) return 200

  // Fuzzy: each char of query appears in order
  let qi = 0
  for (let hi = 0; hi < haystack.length && qi < q.length; hi++) {
    if (haystack[hi] === q[qi]) qi++
  }
  if (qi === q.length) return 100 - (haystack.length - q.length)

  return 0
}
