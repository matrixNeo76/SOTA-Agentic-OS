'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import {
 Search, CornerDownLeft, ArrowUp, ArrowDown, Command as CommandIcon,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
 commandRegistry,
 buildCoreCommands,
 buildPhaseCommands,
 buildToolCommands,
 buildUtilityCommands,
 fuzzyMatch,
 type CommandAction,
 type CommandCategory,
} from './command-registry'

// === Category labels ===
const CATEGORY_LABELS: Record<CommandCategory, string> = {
 actions: 'Azioni',
 views: 'Viste',
 phases: 'Fasi',
 tools: 'Tool & Utility',
 recent: 'Recenti',
}

const CATEGORY_ORDER: CommandCategory[] = ['actions', 'views', 'phases', 'tools', 'recent']

// === Recent commands (persisted in localStorage) ===
const RECENT_KEY = 'sota_cmd_recent'
const MAX_RECENT = 5

function getRecent(): string[] {
 if (typeof window === 'undefined') return []
 try {
 return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
 } catch {
 return []
 }
}

function pushRecent(id: string) {
 if (typeof window === 'undefined') return
 const recent = getRecent().filter((r) => r !== id)
 recent.unshift(id)
 localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}

// === Subscribe to registry changes via useSyncExternalStore ===
// useSyncExternalStore requires getSnapshot to return a cached value (===) across calls
// until the store has actually changed. Since commandRegistry.getAll() returns a fresh
// array each call, we maintain our own cache and invalidate it on notify.
let cachedSnapshot: CommandAction[] | null = null

function getSnapshot(): CommandAction[] {
 if (cachedSnapshot === null) {
 cachedSnapshot = commandRegistry.getAll()
 }
 return cachedSnapshot
}

function getServerSnapshot(): CommandAction[] {
 // Server doesn't have any commands registered — return empty array (cached).
 return EMPTY_ARRAY
}

const EMPTY_ARRAY: CommandAction[] = []

function useRegistryCommands(): CommandAction[] {
 return useSyncExternalStore(
 (cb) => commandRegistry.subscribe(() => {
 // Invalidate cache on change, then notify React
 cachedSnapshot = null
 cb()
 }),
 getSnapshot,
 getServerSnapshot
 )
}

// === Main CommandPalette component ===
export function CommandPalette() {
 const { commandPaletteOpen, setCommandPaletteOpen, setActivePhase, setActiveView } = useStore()

 // Register all static commands on mount
 useEffect(() => {
 const unregisters: Array<() => void> = []

 buildCoreCommands(setActivePhase, setActiveView, setCommandPaletteOpen).forEach((c) => {
 unregisters.push(commandRegistry.register(c))
 })
 buildPhaseCommands(setActivePhase, setCommandPaletteOpen).forEach((c) => {
 unregisters.push(commandRegistry.register(c))
 })
 buildToolCommands(setActivePhase, setCommandPaletteOpen).forEach((c) => {
 unregisters.push(commandRegistry.register(c))
 })
 buildUtilityCommands(setCommandPaletteOpen).forEach((c) => {
 unregisters.push(commandRegistry.register(c))
 })

 return () => unregisters.forEach((u) => u())
 }, [setActivePhase, setActiveView, setCommandPaletteOpen])

 const allCommands = useRegistryCommands()

 // Compute recent commands list (re-evaluated when palette opens/closes)
 const recentIds = useMemo(() => getRecent(), [commandPaletteOpen])
 const recentCommands = useMemo(() => {
 return recentIds
 .map((id) => allCommands.find((c) => c.id === id))
 .filter((c): c is CommandAction => !!c)
 }, [recentIds, allCommands])

 if (!commandPaletteOpen) return null

 const runCommand = (cmd: CommandAction) => {
 pushRecent(cmd.id)
 cmd.action()
 }

 return (
 <PaletteDialog
 key={`palette-${commandPaletteOpen}`} // remount on open to reset query
 onRun={runCommand}
 onClose={() => setCommandPaletteOpen(false)}
 allCommands={allCommands}
 recentCommands={recentCommands}
 />
 )
}

// === Inner dialog (remounted on each open to reset state) ===
function PaletteDialog({
 onRun,
 onClose,
 allCommands,
 recentCommands,
}: {
 onRun: (cmd: CommandAction) => void
 onClose: () => void
 allCommands: CommandAction[]
 recentCommands: CommandAction[]
}) {
 const [query, setQuery] = useState('')

 // Filter + sort by fuzzy score
 const filtered = useMemo(() => {
 const scored = allCommands
 .map((c) => ({ cmd: c, score: fuzzyMatch(query, c) }))
 .filter(({ score }) => score > 0)
 .sort((a, b) => b.score - a.score)

 return scored.map(({ cmd }) => cmd)
 }, [allCommands, query])

 // Group filtered results by category for display
 const grouped = useMemo(() => {
 const groups = new Map<CommandCategory, CommandAction[]>()
 for (const cat of CATEGORY_ORDER) groups.set(cat, [])
 for (const cmd of filtered) {
 const list = groups.get(cmd.category)
 if (list) list.push(cmd)
 }
 return groups
 }, [filtered])

 // Flat list for keyboard nav (when no query: show recent first, then actions/views/phases/tools)
 const flatList = useMemo(() => {
 if (!query) {
 const recent = recentCommands.length > 0 ? recentCommands : []
 const rest = [
 ...filtered.filter((c) => c.category === 'actions'),
 ...filtered.filter((c) => c.category === 'views'),
 ...filtered.filter((c) => c.category === 'phases'),
 ...filtered.filter((c) => c.category === 'tools'),
 ]
 return { recent, rest }
 }
 return { recent: [], rest: filtered }
 }, [query, filtered, recentCommands])

 // Block body scroll while mounted
 useEffect(() => {
 const prev = document.body.style.overflow
 document.body.style.overflow = 'hidden'
 return () => { document.body.style.overflow = prev }
 }, [])

 return (
 <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[15vh] sm:pt-[20vh]">
 {/* Backdrop */}
 <div
 className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in-0 duration-150"
 onClick={onClose}
 aria-hidden
 />

 {/* Palette container */}
 <div className="relative w-full max-w-2xl bg-popover border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200">
 <CommandPrimitive
 className="flex flex-col"
 loop
 shouldFilter={false} // we do our own filtering
 >
 {/* Search input */}
 <div className="flex items-center gap-3 px-4 border-b">
 <Search className="size-4 text-muted-foreground shrink-0" />
 <CommandPrimitive.Input
 value={query}
 onValueChange={setQuery}
 placeholder="Cerca azioni, fasi, tool… (Esc per chiudere)"
 className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
 autoFocus
 />
 <kbd className="hidden sm:inline-flex items-center gap-0.5 h-5 px-1.5 rounded border bg-muted text-[10px] font-mono text-muted-foreground">
 esc
 </kbd>
 </div>

 {/* Results */}
 <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
 {flatList.recent.length === 0 && flatList.rest.length === 0 && (
 <div className="py-12 text-center text-sm text-muted-foreground">
 Nessun risultato per &ldquo;{query}&rdquo;
 </div>
 )}

 {/* Recent (only when no query) */}
 {flatList.recent.length > 0 && (
 <CommandPrimitive.Group
 heading={CATEGORY_LABELS.recent}
 className="mb-2"
 >
 {flatList.recent.map((cmd) => (
 <CommandRow key={`recent-${cmd.id}`} cmd={cmd} onRun={onRun} />
 ))}
 </CommandPrimitive.Group>
 )}

 {/* Other categories */}
 {CATEGORY_ORDER.filter((c) => c !== 'recent').map((cat) => {
 const items = grouped.get(cat) || []
 if (items.length === 0) return null
 return (
 <CommandPrimitive.Group
 key={cat}
 heading={CATEGORY_LABELS[cat]}
 className="mb-2 last:mb-0"
 >
 {items.map((cmd) => (
 <CommandRow key={cmd.id} cmd={cmd} onRun={onRun} />
 ))}
 </CommandPrimitive.Group>
 )
 })}
 </CommandPrimitive.List>

 {/* Footer */}
 <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/30 text-[10px] text-muted-foreground">
 <div className="flex items-center gap-3">
 <span className="flex items-center gap-1">
 <ArrowUp className="size-2.5" />
 <ArrowDown className="size-2.5" />
 naviga
 </span>
 <span className="flex items-center gap-1">
 <CornerDownLeft className="size-2.5" />
 seleziona
 </span>
 <span className="hidden sm:flex items-center gap-1">
 <kbd className="font-mono">esc</kbd>
 chiudi
 </span>
 </div>
 <div className="flex items-center gap-1 font-mono">
 <CommandIcon className="size-2.5" />
 K
 </div>
 </div>
 </CommandPrimitive>
 </div>
 </div>
 )
}

// === Row ===
function CommandRow({ cmd, onRun }: { cmd: CommandAction; onRun: (cmd: CommandAction) => void }) {
 const Icon = cmd.icon
 return (
 <CommandPrimitive.Item
 value={cmd.id}
 onSelect={() => onRun(cmd)}
 className={cn(
 'group flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer',
 'text-sm transition-colors',
 'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
 'data-[selected=true]:bg-primary/10'
 )}
 >
 <Icon className="size-4 shrink-0 text-muted-foreground group-data-[selected=true]:text-primary" />
 <div className="flex-1 min-w-0">
 <div className="font-medium text-foreground truncate">{cmd.label}</div>
 {cmd.description && (
 <div className="text-[11px] text-muted-foreground truncate">{cmd.description}</div>
 )}
 </div>
 {cmd.badge !== undefined && cmd.badge > 0 && (
 <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-status-danger text-white text-[10px] font-bold font-mono">
 {cmd.badge > 99 ? '99+' : cmd.badge}
 </span>
 )}
 {cmd.shortcut && (
 <kbd className="hidden sm:inline-flex items-center gap-0.5 h-5 px-1.5 rounded border bg-muted text-[10px] font-mono text-muted-foreground">
 {cmd.shortcut}
 </kbd>
 )}
 </CommandPrimitive.Item>
 )
}
