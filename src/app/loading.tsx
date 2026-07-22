/**
 * Route-level loading state — Sprint 6.4
 *
 * Mostrato durante il caricamento iniziale di una route.
 */

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 rounded-lg border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-xs text-muted-foreground">Caricamento…</p>
      </div>
    </div>
  )
}
