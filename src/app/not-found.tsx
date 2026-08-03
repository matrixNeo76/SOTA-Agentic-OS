/**
 * 404 Not Found — Sprint 6.4
 *
 * Pagina custom per route non trovate.
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Home, Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <Compass className="size-8 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">404</h1>
          <h2 className="text-sm font-medium text-muted-foreground mt-2">
            Pagina non trovata
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-1">
            La route che cerchi non esiste o è stata spostata.
          </p>
        </div>
        <Link href="/">
          <Button size="sm">
            <Home className="size-3.5 mr-1.5" />
            Torna alla Dashboard
          </Button>
        </Link>
      </div>
    </div>
  )
}
