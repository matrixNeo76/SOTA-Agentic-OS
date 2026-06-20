'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Image as ImageIcon, Download, Palette, ExternalLink } from 'lucide-react'

/**
 * Branding Showcase: mostra i formati branding generati dall'immagine sorgente.
 */
export function BrandingShowcase() {
  const assets = [
    { name: 'Logo Primario', file: '/logo-sota.png', desc: 'Logo con sfondo scuro originale' },
  ]

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <ImageIcon className="size-4" /> Branding Kit
            </CardTitle>
            <CardDescription className="text-xs">
              Asset grafici generati dall'immagine sorgente · 30 file in <code>/download/branding/</code>
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px]">v0.3.0</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Logo showcase */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <div className="aspect-square rounded-md bg-[#0a0a2e] flex items-center justify-center p-2">
              <img src="/logo-sota.png" alt="Logo" className="max-w-full max-h-full object-contain" />
            </div>
            <div className="text-[10px] text-center font-mono">logo-transparent</div>
          </div>
          <div className="space-y-1.5">
            <div className="aspect-square rounded-md bg-white flex items-center justify-center p-2">
              <img src="/og-image.png" alt="OG" className="max-w-full max-h-full object-cover rounded" />
            </div>
            <div className="text-[10px] text-center font-mono">og-image 1200×630</div>
          </div>
          <div className="space-y-1.5">
            <div className="aspect-square rounded-md bg-[#0a0a2e] flex items-center justify-center p-2">
              <img src="/favicon.ico" alt="Favicon" className="w-12 h-12 object-contain" />
            </div>
            <div className="text-[10px] text-center font-mono">favicon.ico</div>
          </div>
          <div className="space-y-1.5">
            <div className="aspect-square rounded-md bg-gradient-to-br from-[#0a0a2e] to-[#3a1e6a] flex items-center justify-center p-2">
              <div className="text-center">
                <div className="text-[#00d4ff] font-bold text-2xl">S</div>
                <div className="text-[#c0c0c0] text-[9px] tracking-wider">SOTA OS</div>
              </div>
            </div>
            <div className="text-[10px] text-center font-mono">color tokens</div>
          </div>
        </div>

        {/* Palette colori */}
        <div>
          <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
            <Palette className="size-3" /> Palette Colori Brand
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[
              { name: 'bg_dark', hex: '#0a0a2e', label: 'Background' },
              { name: 'bg_purple', hex: '#3a1e6a', label: 'Purple' },
              { name: 'accent_blue', hex: '#00d4ff', label: 'Accent' },
              { name: 'text_white', hex: '#ffffff', label: 'White' },
              { name: 'text_silver', hex: '#c0c0c0', label: 'Silver' },
            ].map((c) => (
              <div key={c.name} className="text-center">
                <div
                  className="h-12 rounded-md border border-border"
                  style={{ backgroundColor: c.hex }}
                />
                <div className="text-[9px] font-mono mt-1 text-muted-foreground">{c.hex}</div>
                <div className="text-[9px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Asset list */}
        <div>
          <div className="text-xs font-medium mb-2">Asset disponibili in <code>/download/branding/</code></div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-[10px]">
            {[
              'logo-primary-1024.png', 'logo-primary-512.png', 'logo-primary-256.png',
              'logo-transparent.png', 'logo-transparent-512.png',
              'logo-monochrome-white.png', 'logo-monochrome-black.png',
              'logo-vector.svg',
              'favicon-16/32/48/180/512.png', 'favicon.ico',
              'banner-horizontal-1500x500.png', 'banner-horizontal-1200x400.png',
              'og-image-1200x630.png',
              'avatar-200/400/512.png',
              'app-icon-20/29/40/60/80/87/120/180/512.png',
              'watermark-300.png',
              'color-palette.png + .json',
            ].map((f) => (
              <div key={f} className="font-mono text-muted-foreground truncate">· {f}</div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" asChild>
            <a href="/download/branding/logo-vector.svg" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3 mr-1.5" /> SVG Vector
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href="/download/branding/color-palette.json" target="_blank" rel="noopener noreferrer">
              <Download className="size-3 mr-1.5" /> Palette JSON
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
