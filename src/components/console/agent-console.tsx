'use client'
import { useState, useEffect, useCallback } from 'react'
import { MessageList } from './message-list'
import { ConsoleInput } from './console-input'
import { useConsoleStream } from './use-console-stream'
import { genMessageId, type Message, type Skill } from './types'

export function AgentConsole() {
 const [messages, setMessages] = useState<Message[]>([])
 const [input, setInput] = useState('')
 const [skills, setSkills] = useState<Skill[]>([])
 const { executing, liveLog, send, stopExecution } = useConsoleStream({
 onUserMessage: msg => setMessages(prev => [...prev, msg]),
 onAssistantMessageStart: msg => setMessages(prev => [...prev, msg]),
 onAssistantUpdate: (id, patch) => setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m)),
 })

 useEffect(() => { fetch('/api/skills').then(r => r.json()).then(d => { if (d.skills) setSkills(d.skills.map((s: any) => ({ id: s.id, name: s.name, description: s.description, category: s.category, promptTemplate: '', outputFormat: s.outputFormat, usageCount: s.usageCount }))) }).catch(() => {}) }, [])

 const handleSend = useCallback((t: string) => { send(t, false); setInput('') }, [send])
 const handlePlanOnly = useCallback((t: string) => { send(t, true); setInput('') }, [send])
 const handleSuggestion = useCallback((s: string) => { send(s, false) }, [send])
 const handleRetry = useCallback((msg: Message) => { if (executing) return; const idx = messages.findIndex(m => m.id === msg.id); if (idx === -1) return; setMessages(prev => prev.slice(0, idx)); void send(msg.content, false) }, [executing, messages, send])
 const handleEdit = useCallback((msg: Message) => { if (executing) return; const idx = messages.findIndex(m => m.id === msg.id); if (idx === -1) return; setInput(msg.content); setMessages(prev => prev.slice(0, idx)) }, [executing, messages])

 return (
 <div className="flex flex-col h-full min-h-0">
 <MessageList messages={messages} liveLog={liveLog} executing={executing} onSuggestion={handleSuggestion} onRetry={handleRetry} onEdit={handleEdit} />
 <ConsoleInput input={input} setInput={setInput} executing={executing} onSend={handleSend} onStop={stopExecution} onPlanOnly={handlePlanOnly} skills={skills} />
 </div>
 )
}
