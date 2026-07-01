/**
 * Design Tokens Premium — Sistema unificato
 * Direzione: "Operative Intelligence"
 */

export const SURFACE_COLORS = {
  base: 'bg-background',
  elevated: 'bg-card',
  overlay: 'bg-popover',
} as const

export const CATEGORY_COLORS: Record<string, string> = {
  core: 'text-primary',
  foundation: 'text-cat-foundation',
  orchestration: 'text-cat-orchestration',
  cognitive: 'text-cat-cognitive',
  trust: 'text-cat-trust',
  learning: 'text-cat-learning',
  governance: 'text-cat-governance',
  infrastructure: 'text-cat-infrastructure',
}

export const CATEGORY_LABELS: Record<string, string> = {
  core: 'CORE', foundation: 'FOUNDATION', orchestration: 'ORCHESTRATION',
  cognitive: 'COGNITIVE CONTROL', trust: 'TRUST & VERIFY', learning: 'LEARNING',
  governance: 'GOVERNANCE', infrastructure: 'INFRASTRUCTURE',
}

export const CATEGORY_BG_COLORS: Record<string, string> = {
  core: 'bg-primary/10', foundation: 'bg-cat-foundation/10', orchestration: 'bg-cat-orchestration/10',
  cognitive: 'bg-cat-cognitive/10', trust: 'bg-cat-trust/10', learning: 'bg-cat-learning/10',
  governance: 'bg-cat-governance/10', infrastructure: 'bg-cat-infrastructure/10',
}

export const CATEGORY_BORDER_COLORS: Record<string, string> = {
  core: 'border-primary/30', foundation: 'border-cat-foundation/30', orchestration: 'border-cat-orchestration/30',
  cognitive: 'border-cat-cognitive/30', trust: 'border-cat-trust/30', learning: 'border-cat-learning/30',
  governance: 'border-cat-governance/30', infrastructure: 'border-cat-infrastructure/30',
}

export const STATUS_TONES = {
  ok: { text: 'text-status-ok', bg: 'bg-status-ok/10', border: 'border-status-ok/30', dot: 'bg-status-ok' },
  warn: { text: 'text-status-warn', bg: 'bg-status-warn/10', border: 'border-status-warn/30', dot: 'bg-status-warn' },
  danger: { text: 'text-status-danger', bg: 'bg-status-danger/10', border: 'border-status-danger/30', dot: 'bg-status-danger' },
  info: { text: 'text-status-info', bg: 'bg-status-info/10', border: 'border-status-info/30', dot: 'bg-status-info' },
  muted: { text: 'text-muted-foreground', bg: 'bg-muted/30', border: 'border-border', dot: 'bg-muted-foreground/40' },
} as const

export type StatusTone = keyof typeof STATUS_TONES

export const SHADOW_CLASSES = { xs: 'shadow-xs', sm: 'shadow-sm', md: 'shadow-md', lg: 'shadow-lg', xl: 'shadow-xl' } as const
export type ShadowLevel = keyof typeof SHADOW_CLASSES

export const RADIUS = { xs: 'rounded-xs', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', '2xl': 'rounded-2xl', full: 'rounded-full' } as const
export const FONT_SIZE = { '2xs': 'text-[11px]', xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg', xl: 'text-xl', '2xl': 'text-2xl', '3xl': 'text-3xl' } as const

export function categoryColor(c: string | undefined | null): string { return c ? (CATEGORY_COLORS[c] || CATEGORY_COLORS.core) : CATEGORY_COLORS.core }
export function categoryBgColor(c: string | undefined | null): string { return c ? (CATEGORY_BG_COLORS[c] || CATEGORY_BG_COLORS.core) : CATEGORY_BG_COLORS.core }
export function categoryBorderColor(c: string | undefined | null): string { return c ? (CATEGORY_BORDER_COLORS[c] || CATEGORY_BORDER_COLORS.core) : CATEGORY_BORDER_COLORS.core }
export function categoryLabel(c: string | undefined | null): string { return c ? (CATEGORY_LABELS[c] || c.toUpperCase()) : '' }
export function statusTone(t: StatusTone) { return STATUS_TONES[t] || STATUS_TONES.muted }
export function shadowClass(l: ShadowLevel): string { return SHADOW_CLASSES[l] || SHADOW_CLASSES.sm }
