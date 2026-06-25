'use client'

import { cn } from '@/lib/utils'

/**
 * Skeleton primitive — animated placeholder for loading states.
 * Uses pulse animation (built-in Tailwind animate-pulse).
 *
 * Usage:
 * <Skeleton className="h-4 w-32" />
 * <SkeletonLine />
 * <SkeletonCard />
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
 return (
 <div
 className={cn(
 'rounded-md bg-muted/60 animate-pulse',
 className
 )}
 style={style}
 aria-hidden
 />
 )
}

// === Preset skeletons ===

export function SkeletonLine({ width = '100%', height = 'h-3' }: { width?: string; height?: string }) {
 return <Skeleton className={cn(height)} style={{ width }} />
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
 return (
 <div className="rounded-lg border bg-card/50 p-3 space-y-2">
 <Skeleton className="h-4 w-1/3" />
 {Array.from({ length: lines }).map((_, i) => (
 <Skeleton key={i} className="h-3 w-full" />
 ))}
 </div>
 )
}

export function SkeletonGrid({ cols = 2, rows = 3 }: { cols?: number; rows?: number }) {
 return (
 <div
 className="grid gap-2"
 style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
 >
 {Array.from({ length: cols * rows }).map((_, i) => (
 <Skeleton key={i} className="h-16" />
 ))}
 </div>
 )
}

// === Inspector skeletons ===

export function QuickStatsSkeleton() {
 return (
 <div className="h-full flex flex-col">
 <div className="shrink-0 px-3 py-2.5 border-b">
 <div className="flex items-center gap-2">
 <Skeleton className="size-4 rounded" />
 <Skeleton className="h-4 w-24" />
 <Skeleton className="ml-auto size-1.5 rounded-full" />
 </div>
 <Skeleton className="h-3 w-48 mt-2" />
 </div>
 <div className="flex-1 overflow-y-auto p-3 space-y-3">
 {[1, 2, 3, 4].map((i) => (
 <div key={i} className="rounded-lg border bg-card/50">
 <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b bg-muted/30">
 <Skeleton className="size-3 rounded" />
 <Skeleton className="h-3 w-20" />
 </div>
 <div className="p-1.5 space-y-1.5">
 {[1, 2, 3].map((j) => (
 <div key={j} className="flex items-center gap-2 px-1.5 py-1">
 <Skeleton className="size-3 rounded" />
 <Skeleton className="h-3 flex-1" />
 <Skeleton className="h-3 w-8" />
 </div>
 ))}
 </div>
 </div>
 ))}
 </div>
 </div>
 )
}

export function NodeInspectorSkeleton() {
 return (
 <div className="h-full flex flex-col">
 <div className="shrink-0 px-3 py-2.5 border-b">
 <div className="flex items-center gap-2">
 <Skeleton className="size-4 rounded" />
 <Skeleton className="h-4 w-28" />
 <Skeleton className="ml-auto h-4 w-20 rounded-full" />
 </div>
 <Skeleton className="h-3 w-32 mt-2" />
 </div>
 <div className="flex-1 overflow-y-auto p-3 space-y-3">
 <SkeletonCard lines={2} />
 <SkeletonCard lines={1} />
 <div className="grid grid-cols-2 gap-2">
 <SkeletonCard lines={1} />
 <SkeletonCard lines={1} />
 </div>
 <SkeletonCard lines={3} />
 </div>
 </div>
 )
}

export function LogInspectorSkeleton() {
 return (
 <div className="h-full flex flex-col">
 <div className="shrink-0 px-3 py-2.5 border-b">
 <div className="flex items-center gap-2">
 <Skeleton className="size-4 rounded" />
 <Skeleton className="h-4 w-24" />
 <Skeleton className="ml-auto h-4 w-16 rounded-full" />
 </div>
 <Skeleton className="h-3 w-40 mt-2" />
 </div>
 <div className="flex-1 overflow-y-auto p-3 space-y-3">
 <Skeleton className="h-16 w-full rounded-md" />
 <div className="grid grid-cols-2 gap-2">
 <SkeletonCard lines={1} />
 <SkeletonCard lines={1} />
 </div>
 <SkeletonCard lines={2} />
 <Skeleton className="h-32 w-full rounded-md" />
 </div>
 </div>
 )
}

export function BlockedInspectorSkeleton() {
 return (
 <div className="h-full flex flex-col">
 <div className="shrink-0 px-3 py-2.5 border-b">
 <div className="flex items-center gap-2">
 <Skeleton className="size-4 rounded" />
 <Skeleton className="h-4 w-28" />
 <Skeleton className="ml-auto h-4 w-24 rounded-full" />
 </div>
 <Skeleton className="h-3 w-32 mt-2" />
 </div>
 <div className="flex-1 overflow-y-auto p-3 space-y-3">
 <Skeleton className="h-20 w-full rounded-md bg-status-warn" />
 <div className="grid grid-cols-2 gap-2">
 <SkeletonCard lines={1} />
 <SkeletonCard lines={1} />
 </div>
 <SkeletonCard lines={1} />
 <Skeleton className="h-24 w-full rounded-md" />
 <SkeletonCard lines={3} />
 </div>
 </div>
 )
}

// === View skeletons ===

export function CanvasViewSkeleton() {
 return (
 <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
 <div className="flex items-center justify-between gap-4 pb-4">
 <div className="flex items-center gap-3">
 <Skeleton className="size-5 rounded" />
 <div className="space-y-1.5">
 <Skeleton className="h-5 w-24" />
 <Skeleton className="h-3 w-64" />
 </div>
 </div>
 <Skeleton className="h-8 w-24 rounded-md" />
 </div>
 <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
 <Skeleton className="h-8 w-64 rounded-md" />
 <Skeleton className="h-8 w-48 rounded-md" />
 <Skeleton className="h-8 w-40 rounded-md ml-auto" />
 </div>
 <div className="flex-1 mt-3 rounded-md border bg-card overflow-hidden">
 <div className="h-full w-full flex items-center justify-center">
 <Skeleton className="size-12 rounded-full" />
 </div>
 </div>
 </div>
 )
}

export function TimelineViewSkeleton() {
 return (
 <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
 <div className="flex items-center justify-between gap-4 pb-4">
 <div className="flex items-center gap-3">
 <Skeleton className="size-5 rounded" />
 <div className="space-y-1.5">
 <Skeleton className="h-5 w-24" />
 <Skeleton className="h-3 w-56" />
 </div>
 </div>
 <Skeleton className="h-8 w-24 rounded-md" />
 </div>
 <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
 <Skeleton className="h-8 w-32 rounded-md" />
 <Skeleton className="h-8 w-40 rounded-md" />
 <Skeleton className="h-8 w-32 rounded-md" />
 </div>
 <div className="flex-1 mt-3 rounded-md border bg-card overflow-hidden flex items-center justify-center">
 <Skeleton className="size-12 rounded-full" />
 </div>
 </div>
 )
}

export function SovereignViewSkeleton() {
 return (
 <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
 <div className="flex items-center justify-between gap-4 pb-4">
 <div className="flex items-center gap-3">
 <Skeleton className="size-5 rounded" />
 <div className="space-y-1.5">
 <Skeleton className="h-5 w-24" />
 <Skeleton className="h-3 w-64" />
 </div>
 </div>
 <Skeleton className="h-8 w-32 rounded-md" />
 </div>
 <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pb-3 border-b">
 {Array.from({ length: 6 }).map((_, i) => (
 <div key={i} className="bg-muted/30 rounded-md p-2 text-center space-y-1.5">
 <Skeleton className="h-2.5 w-12 mx-auto" />
 <Skeleton className="h-5 w-8 mx-auto" />
 </div>
 ))}
 </div>
 <div className="flex flex-wrap items-center gap-2 py-3 border-b">
 <Skeleton className="h-8 w-32 rounded-md" />
 <Skeleton className="h-8 w-48 rounded-md" />
 </div>
 <div className="flex-1 mt-3 space-y-2 overflow-y-auto pr-1">
 {[1, 2, 3].map((i) => (
 <div key={i} className="rounded-lg border p-3 space-y-2">
 <div className="flex items-center gap-2">
 <Skeleton className="size-7 rounded-md" />
 <Skeleton className="h-3 w-20 rounded-full" />
 <Skeleton className="h-3 w-16 rounded-full" />
 <Skeleton className="h-3 w-24 ml-auto" />
 </div>
 <Skeleton className="h-4 w-3/4" />
 <Skeleton className="h-3 w-full" />
 </div>
 ))}
 </div>
 </div>
 )
}
