/**
 * Route-level error boundary — Sprint 6.4
 *
 * Cattura errori non gestiti nelle route e mostra un fallback
 * con opzione di retry.
 */

'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[route-error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="size-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="size-6 text-red-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Si è verificato un errore</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Qualcosa è andato storto nel caricamento della pagina.
          </p>
        </div>
        {error.message && (
          <pre className="text-[10px] font-mono text-muted-foreground bg-muted/30 rounded-md p-2 max-h-32 overflow-auto">
            {error.message}
          </pre>
        )}
        <div className="flex items-center justify-center gap-2">
          <Button onClick={reset} size="sm">
            <RotateCcw className="size-3.5 mr-1.5" />
            Riprova
          </Button>
          <Button
            onClick={() => window.location.href = '/'}
            variant="outline"
            size="sm"
          >
            Torna alla home
          </Button>
        </div>
      </div>
    </div>
  )
}
