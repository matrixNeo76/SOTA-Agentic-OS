'use client'

import {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
  Scissors, GitFork, FunctionSquare, UserCog,
  Boxes, HeartPulse, Target, Network, Shuffle,
  Gauge, Package, Terminal,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Database,
  Workflow,
  Compass,
  ShieldCheck,
  Sparkles,
  Scissors,
  GitFork,
  FunctionSquare,
  UserCog,
  Boxes,
  HeartPulse,
  Target,
  Network,
  Shuffle,
  Gauge,
  Package,
  Terminal,
}

export function getIcon(name: string): LucideIcon {
  return ICON_MAP[name] || LayoutDashboard
}
