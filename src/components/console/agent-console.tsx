'use client'
/**
 * AgentConsole — C6.9 Fase 5
 *
 * Improvements:
 *   - History persistence: messages saved to localStorage, restored on mount.
 *     User can clear history via the clear button.
 *   - Retry con contesto: when retrying a failed message, the previous error
 *     is passed as context so the LLM knows what went wrong.
 *   - New conversation button: clears messages + localStorage.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageList } from './message-list'
import { ConsoleInput } from './console-input'
import { useConsoleStream } from './use-console-stream'
import { genMessageId, type Message, type Skill } from './types'
import { toast } from 'sonner'
import { Eraser, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'sota_console_history'
const MAX_HISTORY = 50 // max messages persisted

// === localStorage helpers ============================================

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Message[]
    if (!Array.isArray(parsed)) return []
    // Filter out any messages that are mid-streaming (empty assistant content + no result)
    return parsed.filter(m => m.content || m.result || m.error)
  } catch {
    return []
  }
}

function saveHistory(messages: Message[]) {
  if (typeof window === 'undefined') return
  try {
    // Only save the last MAX_HISTORY messages to avoid quota issues
    const toSave = messages.slice(-MAX_HISTORY)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch {
    // localStorage might be full — silently ignore
  }
}

function clearHistory() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

// === Main component ==================================================

export function AgentConsole() {
  // C6.9 — Restore from localStorage on first mount
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { executing, liveLog, send, stopExecution } = useConsoleStream({
    onUserMessage: msg => setMessages(prev => [...prev, msg]),
    onAssistantMessageStart: msg => setMessages(prev => [...prev, msg]),
    onAssistantUpdate: (id, patch) => setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m)),
  })

  // C6.9 — Load history on mount
  useEffect(() => {
    const restored = loadHistory()
    if (restored.length > 0) {
      setMessages(restored)
    }
    setHistoryLoaded(true)
  }, [])

  // C6.9 — Debounced save to localStorage whenever messages change
  useEffect(() => {
    if (!historyLoaded) return // don't save before initial load
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveHistory(messages)
    }, 500) // debounce 500ms
  }, [messages, historyLoaded])

  useEffect(() => { fetch('/api/skills').then(r => r.json()).then(d => { if (d.skills) setSkills(d.skills.map((s: any) => ({ id: s.id, name: s.name, description: s.description, category: s.category, promptTemplate: '', outputFormat: s.outputFormat, usageCount: s.usageCount }))) }).catch(() => {}) }, [])

  const handleSend = useCallback((t: string) => { send(t, false); setInput('') }, [send])
  const handlePlanOnly = useCallback((t: string) => { send(t, true); setInput('') }, [send])
  const handleSuggestion = useCallback((s: string) => { send(s, false) }, [send])

  // C6.9 — Retry con contesto: pass the previous error message as context
  const handleRetry = useCallback((msg: Message) => {
    if (executing) return
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    // Find the assistant message that followed this user message (the failed one)
    const failedAssistant = messages[idx + 1]
    const errorContext = failedAssistant?.error || failedAssistant?.errors?.[0]?.message
    setMessages(prev => prev.slice(0, idx))
    // If we have error context, prepend it to the message for the LLM
    if (errorContext) {
      void send(`${msg.content}\n\n[Previous attempt failed with: ${errorContext}. Please try a different approach.]`, false)
    } else {
      void send(msg.content, false)
    }
  }, [executing, messages, send])

  const handleEdit = useCallback((msg: Message) => {
    if (executing) return
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    setInput(msg.content)
    setMessages(prev => prev.slice(0, idx))
  }, [executing, messages])

  // C6.9 — New conversation: clear messages + localStorage
  const handleNewConversation = useCallback(() => {
    if (messages.length > 0 && !confirm('Start a new conversation? Current history will be cleared.')) return
    setMessages([])
    clearHistory()
    toast.success('New conversation started')
  }, [messages.length])

  const hasHistory = messages.length > 0

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* C6.9 — Header bar with history info + new conversation */}
      {hasHistory && !executing && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <MessageSquare className="size-2.5" />
            {messages.length} message{messages.length === 1 ? '' : 's'} · saved locally
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNewConversation}
            className="h-5 px-1.5 text-[10px]"
            aria-label="Start new conversation"
          >
            <Eraser className="size-2.5 mr-0.5" />
            New
          </Button>
        </div>
      )}
      <MessageList messages={messages} liveLog={liveLog} executing={executing} onSuggestion={handleSuggestion} onRetry={handleRetry} onEdit={handleEdit} />
      <ConsoleInput input={input} setInput={setInput} executing={executing} onSend={handleSend} onStop={stopExecution} onPlanOnly={handlePlanOnly} skills={skills} />
    </div>
  )
}
