'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Sparkles, Plus, Upload, Download, Play, Trash2, RefreshCw,
  Loader2, Search, Terminal, FileCode,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

type Skill = {
  id: string
  name: string
  description: string
  category: string
  outputFormat: string
  usageCount: number
  successRate: number
  createdBy: string
  isPublic: boolean
  createdAt: string
}

const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  builtin: Sparkles,
  custom: Terminal,
  imported: Upload,
  preset: FileCode,
}

const CATEGORY_COLORS: Record<string, string> = {
  builtin: 'text-violet-600 dark:text-violet-400',
  custom: 'text-sky-600 dark:text-sky-400',
  imported: 'text-amber-600 dark:text-amber-400',
  preset: 'text-emerald-600 dark:text-emerald-400',
}

export function SkillManager() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executeInput, setExecuteInput] = useState('')
  const [executeResult, setExecuteResult] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/skills')
      const d = await r.json()
      setSkills(d.skills || [])
    } catch {
      toast.error('Errore caricamento skills')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleInitialize = async () => {
    try {
      await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'initialize' }),
      })
      toast.success('Skill builtin inizializzate')
      load()
    } catch {
      toast.error('Errore inizializzazione')
    }
  }

  const handleExecute = async (skillId: string) => {
    setExecuting(true)
    setExecuteResult(null)
    try {
      const r = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          skillId,
          variables: {
            input: executeInput, task: executeInput, code: executeInput,
            action: executeInput, context: executeInput, period: executeInput,
            metrics: executeInput, events: executeInput, incident: executeInput,
            systems: executeInput, timestamp: new Date().toISOString(),
          },
        }),
      })
      const d = await r.json()
      if (d.ok !== false && d.output !== undefined) {
        setExecuteResult(d.output)
        toast.success(`Skill eseguita in ${(d.durationMs / 1000).toFixed(1)}s`)
      } else {
        toast.error(d.error || 'Errore esecuzione')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setExecuting(false)
    }
  }

  const handleDelete = async (skillId: string) => {
    if (!confirm('Eliminare questa skill?')) return
    try {
      await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', skillId }),
      })
      toast.success('Skill eliminata')
      load()
      setSelectedId(null)
    } catch {
      toast.error('Errore eliminazione')
    }
  }

  const handleExport = async (skillId: string) => {
    try {
      const r = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export', skillId }),
      })
      const d = await r.json()
      if (d.ok) {
        navigator.clipboard.writeText(d.json).catch(() => {})
        toast.success('Skill exportata (JSON copiato negli appunti)')
      }
    } catch {
      toast.error('Errore export')
    }
  }

  const filtered = skills.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  )

  const selected = skills.find(s => s.id === selectedId)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Skill Manager</h2>
          <Badge variant="secondary" className="text-[10px]">{skills.length} skills</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="size-3.5 mr-1.5" />Crea
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport(!showImport)}>
            <Upload className="size-3.5 mr-1.5" />Importa
          </Button>
          <Button variant="outline" size="sm" onClick={handleInitialize}>
            <Sparkles className="size-3.5 mr-1.5" />Builtin
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca skill…"
          className="pl-10 h-9 text-sm"
        />
      </div>

      {showCreate && <CreateSkillForm onCreated={() => { load(); setShowCreate(false) }} />}
      {showImport && <ImportSkillForm onImported={() => { load(); setShowImport(false) }} />}

      <div className="grid lg:grid-cols-[1fr,1.5fr] gap-4">
        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground italic">
                {skills.length === 0 ? 'Nessuna skill. Clicca "Builtin" per inizializzare.' : 'Nessun risultato.'}
              </p>
            </div>
          ) : (
            filtered.map(skill => {
              const Icon = CATEGORY_ICONS[skill.category] || Terminal
              const isSelected = selectedId === skill.id
              return (
                <button
                  key={skill.id}
                  onClick={() => { setSelectedId(skill.id); setExecuteResult(null) }}
                  className={cn(
                    'w-full text-left p-3 rounded-md border transition-all',
                    isSelected ? 'border-primary bg-primary/10' : 'hover:bg-accent/40'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon className={cn('size-4 shrink-0 mt-0.5', CATEGORY_COLORS[skill.category])} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{skill.name}</span>
                        {skill.isPublic && <Badge variant="outline" className="text-[8px] py-0">PUBLIC</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{skill.description}</div>
                      <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                        <span className="font-mono">{skill.usageCount}×</span>
                        <span>·</span>
                        <span className="capitalize">{skill.category}</span>
                        <span>·</span>
                        <span className="capitalize">{skill.outputFormat}</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="border rounded-lg p-4">
          {selected ? (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold">{selected.name}</h3>
                  <Badge variant="outline" className="text-[9px] capitalize">{selected.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{selected.description}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">Usage</div>
                  <div className="font-mono font-semibold">{selected.usageCount}</div>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">Success</div>
                  <div className="font-mono font-semibold">{(selected.successRate * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">Output</div>
                  <div className="font-mono font-semibold capitalize">{selected.outputFormat}</div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Input</Label>
                <Textarea
                  value={executeInput}
                  onChange={(e) => setExecuteInput(e.target.value)}
                  placeholder="Inserisci l'input per la skill…"
                  rows={3}
                  className="text-xs mt-1"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleExecute(selected.id)}
                  disabled={executing || !executeInput.trim()}
                >
                  {executing ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Play className="size-3.5 mr-1.5" />}
                  Esegui
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport(selected.id)}>
                  <Download className="size-3.5 mr-1.5" />Export
                </Button>
                {selected.category !== 'builtin' && (
                  <Button variant="outline" size="sm" onClick={() => handleDelete(selected.id)}>
                    <Trash2 className="size-3.5 mr-1.5" />Elimina
                  </Button>
                )}
              </div>

              {executeResult && (
                <div>
                  <Label className="text-xs font-medium">Risultato</Label>
                  <pre className="mt-1 p-3 rounded-md bg-surface-code text-surface-code-foreground text-[11px] font-mono max-h-64 overflow-auto whitespace-pre-wrap break-words">
                    {executeResult}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-xs text-muted-foreground italic">
              Seleziona una skill per visualizzare i dettagli ed eseguirla.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateSkillForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [outputFormat, setOutputFormat] = useState('text')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name || !promptTemplate) {
      toast.error('Nome e prompt template sono obbligatori')
      return
    }
    setLoading(true)
    try {
      const r = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name,
          description: description || 'Custom skill',
          promptTemplate,
          outputFormat,
          category: 'custom',
        }),
      })
      const d = await r.json()
      if (d.ok) {
        toast.success('Skill creata')
        onCreated()
      } else {
        toast.error(d.error || 'Errore')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Plus className="size-3.5" /> Nuova Skill
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" placeholder="my-skill" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Output format</Label>
          <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}
            className="w-full h-9 rounded-md border bg-background px-3 text-sm">
            <option value="text">Text</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Descrizione</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 text-sm" placeholder="Cosa fa questa skill" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Prompt template (usa {'{{variables}}'} per i placeholder)</Label>
        <Textarea value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)}
          rows={5} className="text-xs font-mono" placeholder="Analyze the following: {{input}}&#10;&#10;Provide a structured response." />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleCreate} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Plus className="size-3.5 mr-1.5" />}
          Crea skill
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setName(''); setDescription(''); setPromptTemplate('') }}>
          Pulisci
        </Button>
      </div>
    </div>
  )
}

function ImportSkillForm({ onImported }: { onImported: () => void }) {
  const [json, setJson] = useState('')
  const [loading, setLoading] = useState(false)

  const handleImport = async () => {
    if (!json.trim()) {
      toast.error('Incolla un JSON valido')
      return
    }
    setLoading(true)
    try {
      const r = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', json }),
      })
      const d = await r.json()
      if (d.ok) {
        toast.success('Skill importata')
        onImported()
      } else {
        toast.error(d.error || 'Errore importazione')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Upload className="size-3.5" /> Importa Skill da JSON
      </div>
      <Textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={8}
        className="text-xs font-mono"
        placeholder={'{\n  "name": "my-skill",\n  "description": "Description",\n  "promptTemplate": "Analyze: {{input}}",\n  "outputFormat": "text"\n}'}
      />
      <Button size="sm" onClick={handleImport} disabled={loading}>
        {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Upload className="size-3.5 mr-1.5" />}
        Importa
      </Button>
    </div>
  )
}
