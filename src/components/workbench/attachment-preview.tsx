'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Image as ImageIcon, FileCode, Braces, Link2, FileText, ChevronDown, ChevronRight,
} from 'lucide-react'

/**
 * Attachment preview for content embedded in messages.
 *
 * Detects:
 * 1. Image URLs (jpg/png/gif/webp/svg) → inline thumbnail with click-to-zoom
 * 2. JSON blocks (```json ... ```) → collapsible tree-like preview
 * 3. Code blocks (```lang ... ```) → syntax-styled code preview
 * 4. Generic URLs → link card with favicon
 *
 * No drag-drop in 1.0 — only URL/block detection inside existing message text.
 * Drag-drop is deferred to Release 1.1.
 */

type Attachment =
  | { kind: 'image'; url: string; alt: string }
  | { kind: 'json'; content: string }
  | { kind: 'code'; content: string; lang: string }
  | { kind: 'link'; url: string }

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

export function AttachmentPreview({ text }: { text: string }) {
  const attachments = useMemo(() => parseAttachments(text), [text])

  if (attachments.length === 0) return null

  return (
    <div className="space-y-2 mt-2">
      {attachments.map((att, i) => {
        if (att.kind === 'image') return <ImagePreview key={i} url={att.url} alt={att.alt} />
        if (att.kind === 'json') return <JsonPreview key={i} content={att.content} />
        if (att.kind === 'code') return <CodePreview key={i} content={att.content} lang={att.lang} />
        return <LinkPreview key={i} url={att.url} />
      })}
    </div>
  )
}

// === Parser ===
function parseAttachments(text: string): Attachment[] {
  const out: Attachment[] = []
  const seen = new Set<string>()

  // 1. Code blocks (```lang ... ```) — captures both json and code
  const codeBlockRe = /```(\w+)?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = codeBlockRe.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase()
    const content = m[2].trim()
    const key = `code:${lang}:${content.slice(0, 60)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (lang === 'json') {
      out.push({ kind: 'json', content })
    } else {
      out.push({ kind: 'code', content, lang: lang || 'text' })
    }
  }

  // 2. URLs (excluding ones already inside code blocks)
  // Strip code blocks from URL detection to avoid duplicates
  const textWithoutCode = text.replace(/```[\s\S]*?```/g, ' ')
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi
  while ((m = urlRe.exec(textWithoutCode)) !== null) {
    const url = m[0].replace(/[.,;:!?)]+$/, '')  // trim trailing punctuation
    if (seen.has(url)) continue
    seen.add(url)
    if (IMAGE_EXT.test(url)) {
      out.push({ kind: 'image', url, alt: url.split('/').pop() || 'image' })
    } else {
      out.push({ kind: 'link', url })
    }
  }

  return out.slice(0, 5)  // cap to 5 attachments per message
}

// === Image preview ===
function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false)
  const [errored, setErrored] = useState(false)

  if (errored) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground border rounded-md p-2 max-w-xs">
        <ImageIcon className="size-3.5 shrink-0" />
        <span className="truncate">{alt}</span>
        <span className="text-[10px] italic">(anteprima non disponibile)</span>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="block max-w-xs max-h-48 rounded-lg overflow-hidden border hover:ring-2 hover:ring-primary/30 transition-all"
        title="Click per ingrandire"
      >
        <img
          src={url}
          alt={alt}
          onError={() => setErrored(true)}
          className="block w-full h-auto object-cover"
          loading="lazy"
        />
      </button>

      {zoomed && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in-0 duration-150"
          onClick={() => setZoomed(false)}
        >
          <img
            src={url}
            alt={alt}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 size-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}

// === JSON preview ===
function JsonPreview({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  // Compute parse result during render (pure, no setState needed)
  let parsed: unknown = null
  let parseError: string | null = null
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'JSON non valido'
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/50 hover:bg-muted transition-colors text-xs"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Braces className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span className="font-mono font-medium">JSON</span>
        <span className="text-muted-foreground ml-1">
          {parseError ? 'invalido' : `${countNodes(parsed)} nodi`}
        </span>
      </button>
      {expanded && (
        <pre className="p-3 text-[11px] font-mono overflow-x-auto bg-zinc-950 text-zinc-300 max-h-64 overflow-y-auto">
          {parseError ? (
            <span className="text-red-400">{parseError}</span>
          ) : (
            JSON.stringify(parsed, null, 2)
          )}
        </pre>
      )}
    </div>
  )
}

function countNodes(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1
  if (Array.isArray(value)) return value.reduce<number>((acc: number, v: unknown) => acc + countNodes(v), 1)
  return Object.values(value as Record<string, unknown>).reduce<number>((acc: number, v: unknown) => acc + countNodes(v), 1)
}

// === Code preview ===
function CodePreview({ content, lang }: { content: string; lang: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split('\n')
  const isLong = lines.length > 8

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 text-xs">
        <FileCode className="size-3.5 text-sky-600 dark:text-sky-400" />
        <span className="font-mono font-medium uppercase">{lang}</span>
        <span className="text-muted-foreground">{lines.length} righe</span>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-[10px] text-primary hover:underline"
          >
            {expanded ? 'Riduci' : 'Espandi tutto'}
          </button>
        )}
      </div>
      <pre className={cn(
        'p-3 text-[11px] font-mono overflow-x-auto bg-zinc-950 text-zinc-300',
        !expanded && isLong && 'max-h-32 overflow-y-auto'
      )}>
        {content}
      </pre>
    </div>
  )
}

// === Link preview ===
function LinkPreview({ url }: { url: string }) {
  let hostname = url
  try {
    hostname = new URL(url).hostname
  } catch {
    // ignore
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 p-2.5 rounded-lg border hover:bg-accent/50 transition-colors max-w-md group"
    >
      <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
        <Link2 className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate group-hover:text-primary transition-colors">{hostname}</div>
        <div className="text-[10px] text-muted-foreground truncate">{url}</div>
      </div>
      <FileText className="size-3 text-muted-foreground shrink-0" />
    </a>
  )
}
