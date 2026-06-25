'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
 Copy, Check, RotateCcw, Pencil, GitBranch, Share2, Link2, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * Inline actions toolbar shown on hover over each message bubble.
 *
 * Actions:
 * - Copy: copies the message text to clipboard (all messages)
 * - Retry: re-submits the user message (user only)
 * - Edit: loads text into input + truncates history (user only)
 * - Branch: forks conversation from this message (user only, R1.2)
 * - Share: generates a shareable signed URL (all messages, R1.2)
 */
export function InlineActions({
 content,
 isUser,
 messageId,
 messages,
 onRetry,
 onEdit,
 className,
}: {
 content: string
 isUser: boolean
 messageId?: string
 messages?: Array<{ id: string; role: string; content: string; timestamp: string; result?: unknown; isPlanOnly?: boolean; error?: string; errors?: unknown[] }>
 onRetry?: () => void
 onEdit?: () => void
 className?: string
}) {
 const [copied, setCopied] = useState(false)
 const [branching, setBranching] = useState(false)
 const [sharing, setSharing] = useState(false)

 const handleCopy = async () => {
 try {
 await navigator.clipboard.writeText(content)
 setCopied(true)
 toast.success('Testo copiato')
 setTimeout(() => setCopied(false), 1500)
 } catch {
 try {
 const ta = document.createElement('textarea')
 ta.value = content
 ta.style.position = 'fixed'
 ta.style.opacity = '0'
 document.body.appendChild(ta)
 ta.focus()
 ta.select()
 document.execCommand('copy')
 document.body.removeChild(ta)
 setCopied(true)
 toast.success('Testo copiato')
 setTimeout(() => setCopied(false), 1500)
 } catch {
 toast.error('Impossibile copiare')
 }
 }
 }

 // === Branch: fork conversation from this message ===
 const handleBranch = async () => {
 if (!messageId || !messages) return
 setBranching(true)
 try {
 // Find index of this message and take all messages up to and including it
 const idx = messages.findIndex((m) => m.id === messageId)
 if (idx === -1) {
 toast.error('Messaggio non trovato')
 return
 }
 const branchMessages = messages.slice(0, idx + 1)

 const r = await fetch('/api/conversation/branch', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'create',
 messageId,
 messages: branchMessages,
 taskText: content,
 title: `Branch da ${messageId.slice(-8)}`,
 }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Branch creato: ${d.branchId.slice(-12)}`, {
 description: `${branchMessages.length} messaggi forkati in una nuova conversazione.`,
 })
 // In a full implementation, we'd navigate to the branch view
 // For now, just notify the user
 } else {
 toast.error(d.error || 'Errore creazione branch')
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setBranching(false)
 }
 }

 // === Share: generate signed URL ===
 const handleShare = async () => {
 if (!messages) return
 setSharing(true)
 try {
 // Share all messages up to this one
 const idx = messageId ? messages.findIndex((m) => m.id === messageId) : messages.length - 1
 const shareMessages = idx >= 0 ? messages.slice(0, idx + 1) : messages

 const r = await fetch('/api/conversation/share', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'create',
 messages: shareMessages,
 title: `Conversazione del ${new Date().toLocaleDateString('it-IT')}`,
 expiresInHours: 24 * 7, // 7 days
 }),
 })
 const d = await r.json()
 if (d.ok) {
 const fullUrl = `${window.location.origin}${d.url}`
 // Copy to clipboard
 try {
 await navigator.clipboard.writeText(fullUrl)
 toast.success('Link condivisibile copiato!', {
 description: `${fullUrl.substring(0, 60)}... · Scade tra 7 giorni`,
 duration: 8000,
 })
 } catch {
 toast.success('Link creato', {
 description: fullUrl,
 duration: 10000,
 })
 }
 } else {
 toast.error(d.error || 'Errore creazione link')
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setSharing(false)
 }
 }

 return (
 <div
 className={cn(
 'absolute opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
 'flex items-center gap-0.5 z-10',
 isUser
 ? 'left-2 -bottom-7'
 : 'right-0 -bottom-7',
 className
 )}
 >
 <button
 type="button"
 onClick={handleCopy}
 className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-all text-muted-foreground hover:text-foreground active:scale-95"
 title="Copia testo"
 aria-label="Copia testo"
 >
 {copied ? <Check className="size-3.5 text-status-ok" /> : <Copy className="size-3.5" />}
 </button>

 {isUser && onRetry && (
 <button
 type="button"
 onClick={onRetry}
 className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-all text-muted-foreground hover:text-foreground active:scale-95"
 title="Riprova"
 aria-label="Riprova invio"
 >
 <RotateCcw className="size-3.5" />
 </button>
 )}

 {isUser && onEdit && (
 <button
 type="button"
 onClick={onEdit}
 className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-all text-muted-foreground hover:text-foreground active:scale-95"
 title="Modifica e reinvia"
 aria-label="Modifica messaggio"
 >
 <Pencil className="size-3.5" />
 </button>
 )}

 {/* Branch — fork conversation from this message (user messages only) */}
 {isUser && messageId && messages && (
 <button
 type="button"
 onClick={handleBranch}
 disabled={branching}
 className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-all text-muted-foreground hover:text-foreground active:scale-95 disabled:opacity-50"
 title="Fork conversazione da qui"
 aria-label="Crea branch"
 >
 {branching ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
 </button>
 )}

 {/* Share — generate signed URL (all messages) */}
 {messageId && messages && (
 <button
 type="button"
 onClick={handleShare}
 disabled={sharing}
 className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-all text-muted-foreground hover:text-foreground active:scale-95 disabled:opacity-50"
 title="Genera link condivisibile"
 aria-label="Condividi"
 >
 {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
 </button>
 )}
 </div>
 )
}
