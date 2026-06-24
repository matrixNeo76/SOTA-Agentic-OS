'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { genMessageId, type Message } from './types'

export type StreamCallbacks = {
  onUserMessage: (msg: Message) => void
  onAssistantMessageStart: (msg: Message) => void
  onAssistantUpdate: (id: string, patch: Partial<Message>) => void
}

export function useConsoleStream(callbacks: StreamCallbacks) {
  const [executing, setExecuting] = useState(false)
  const [liveLog, setLiveLog] = useState<string[]>([])
  const executingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const { events } = useSensoriumLive()
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    if (!executing) return
    const recent = events[0]
    if (!recent) return
    const line = `[P${recent.phase}] ${recent.agentId}: ${recent.event}`
    setLiveLog(prev => prev.length < 50 ? [...prev, line] : prev)
  }, [events, executing])

  const send = useCallback(async (taskText: string, planOnly = false) => {
    const trimmed = taskText.trim()
    if (!trimmed || executingRef.current) return
    executingRef.current = true
    setExecuting(true)
    setLiveLog([])
    const userMsg: Message = { id: genMessageId(), role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    callbacksRef.current.onUserMessage(userMsg)
    const assistantId = genMessageId()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(), isPlanOnly: planOnly }
    callbacksRef.current.onAssistantMessageStart(assistantMsg)
    const updateAssistant = (patch: Partial<Message>) => callbacksRef.current.onAssistantUpdate(assistantId, patch)
    const appendLog = (line: string) => setLiveLog(prev => prev.length < 50 ? [...prev, line] : prev)
    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const r = await fetch('/api/console/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: trimmed, mode: planOnly ? 'plan-only' : 'full' }), signal: abortController.signal })
      if (!r.ok) { const text = await r.text(); throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`) }
      const reader = r.body?.getReader()
      if (!reader) throw new Error('Stream non disponibile')
      const decoder = new TextDecoder()
      let buffer = ''
      const processEvent = (event: string, data: string) => {
        try {
          const payload = JSON.parse(data)
          switch (event) {
            case 'plan_start': appendLog('[PLAN] avvio...'); updateAssistant({ content: 'Generazione piano…' }); break
            case 'plan_chunk': appendLog(`[PLAN] ${(payload.partial || '').slice(-60)}…`); break
            case 'plan_complete': appendLog(`[PLAN] ${payload.plan?.tasks?.length || 0} task`); updateAssistant({ content: planOnly ? `Piano: ${payload.plan?.tasks?.length || 0} task.` : `Piano pronto. Esecuzione…` }); break
            case 'task_start': appendLog(`[TASK ${payload.step?.taskId}] ${payload.step?.agentId}`); updateAssistant({ content: `Task ${payload.step?.taskId}…` }); break
            case 'task_chunk': appendLog(`[TASK ${payload.taskId}] ${(payload.partial || '').slice(-60)}…`); break
            case 'task_complete': appendLog(`[TASK ${payload.step?.taskId}] ${payload.step?.status}`); break
            case 'reflection_start': appendLog('[REFLECT]…'); break
            case 'reflection_complete': appendLog(`[REFLECT] ${payload.reflection?.approved ? 'ok' : 'red line'}`); break
            case 'error': appendLog(`[ERROR] ${payload.error?.message || 'err'}`); break
            case 'done':
              if (payload.ok) {
                const s = payload.result?.summary
                updateAssistant({ content: planOnly ? `Piano: ${s?.totalTasks || 0} task.` : s && (s.failed > 0 || s.blocked > 0) ? `Task con problemi: ${s.completed}/${s.totalTasks} ok, ${s.failed + s.blocked} falliti.` : `Completato in ${((s?.durationMs || 0) / 1000).toFixed(1)}s — ${s?.completed}/${s?.totalTasks} task.`, result: payload.result, errors: payload.result?.errors })
                if (!planOnly) toast.success(`${s?.completed || 0}/${s?.totalTasks || 0} task completati`)
              } else { updateAssistant({ content: `Errore: ${payload.error || 'sconosciuto'}`, error: payload.error, errors: payload.errors }); toast.error(payload.error || 'Errore') }
              break
          }
        } catch {}
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx); buffer = buffer.slice(idx + 2)
          const lines = raw.split('\n'); let evt = 'message'; let data = ''
          for (const line of lines) { if (line.startsWith('event: ')) evt = line.slice(7); else if (line.startsWith('data: ')) data = line.slice(6) }
          processEvent(evt, data)
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') { updateAssistant({ content: '⏹ Interrotto.' }); toast.info('Interrotto') }
      else { const msg = e.message || 'Errore'; toast.error(msg); updateAssistant({ content: `Errore: ${msg}`, error: msg, errors: [{ type: 'unknown', message: msg, phase: 'network', recoverable: true, suggestion: 'Riprova.' }] }) }
    } finally { executingRef.current = false; abortRef.current = null; setExecuting(false); setLiveLog([]) }
  }, [])

  const stopExecution = useCallback(() => { abortRef.current?.abort() }, [])
  return { executing, liveLog, send, stopExecution }
}
