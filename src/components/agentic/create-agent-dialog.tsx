'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { UserPlus, X, Loader2, Cpu, Wrench, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModelOption = {
  modelId: string
  name: string
  specialization: string
  costPer1kTokens?: number
  avgLatencyMs?: number
}

type SkillOption = {
  uri: string
  name: string
  description: string
  lifecycleState: string
}

type AgentOption = {
  uri: string
  name: string
  description?: string
}

type Role = 'orchestrator' | 'curator' | 'controller' | 'verifier' | 'reflective' | 'custom'

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'orchestrator', label: 'Orchestrator', description: 'Coordina il piano e distribuisce i task' },
  { value: 'curator', label: 'Curator', description: 'Raccoglie e organizza contesto' },
  { value: 'controller', label: 'Controller', description: 'Esegue azioni e processa dati' },
  { value: 'verifier', label: 'Verifier', description: 'Valida risultati e applica regole' },
  { value: 'reflective', label: 'Reflective', description: 'Sintetizza e riflette sui risultati' },
  { value: 'custom', label: 'Custom', description: 'Ruolo personalizzato' },
]

export function CreateAgentDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (agentUri: string, agentName: string) => void
}) {
  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [role, setRole] = useState<Role>('orchestrator')
  const [modelId, setModelId] = useState<string>('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [newCapability, setNewCapability] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [parentAgent, setParentAgent] = useState<string>('none')
  const [creating, setCreating] = useState(false)

  // Data sources
  const [models, setModels] = useState<ModelOption[]>([])
  const [skills, setSkills] = useState<SkillOption[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])

  // Fetch data on dialog open
  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/router?action=models').then(r => r.json()).catch(() => ({ models: [] })),
      fetch('/api/skill-registry').then(r => r.json()).catch(() => ({ skills: [] })),
      fetch('/api/agent-lifecycle').then(r => r.json()).catch(() => ({ agents: [] })),
    ]).then(([modelsData, skillsData, agentsData]) => {
      setModels(modelsData.models || [])
      setSkills((skillsData.skills || []).filter((s: SkillOption) => s.lifecycleState === 'active'))
      setAgents(agentsData.agents || [])
    })
  }, [open])

  const addCapability = useCallback(() => {
    const cap = newCapability.trim()
    if (cap && !capabilities.includes(cap)) {
      setCapabilities([...capabilities, cap])
      setNewCapability('')
    }
  }, [newCapability, capabilities])

  const removeCapability = useCallback((cap: string) => {
    setCapabilities(capabilities.filter(c => c !== cap))
  }, [capabilities])

  const toggleSkill = useCallback((uri: string) => {
    setSelectedSkills(prev =>
      prev.includes(uri) ? prev.filter(s => s !== uri) : [...prev, uri]
    )
  }, [])

  const handleCreate = useCallback(async () => {
    if (!name.trim()) { toast.error('Name è obbligatorio'); return }
    if (!description.trim()) { toast.error('Description è obbligatoria'); return }
    if (name.trim().length < 2) { toast.error('Name deve essere almeno 2 caratteri'); return }

    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        action: 'register',
        name: name.trim(),
        description: description.trim(),
        version: version.trim() || '1.0.0',
        roles: [{ name: role, description: ROLES.find(r => r.value === role)?.description || '' }],
      }
      if (capabilities.length > 0) {
        body.capabilities = capabilities.map(c => ({ name: c, description: '' }))
      }
      if (selectedSkills.length > 0) {
        body.skills = selectedSkills
      }
      if (parentAgent !== 'none') {
        body.parentAgent = parentAgent
      }

      const r = await fetch('/api/agent-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d.error || `Creazione fallita (HTTP ${r.status})`)
        return
      }
      toast.success(`Agente "${name}" creato con successo`)
      onCreated?.(d.uri || '', name)
      // Reset form
      setName(''); setDescription(''); setVersion('1.0.0'); setRole('orchestrator')
      setModelId(''); setCapabilities([]); setSelectedSkills([]); setParentAgent('none')
      onOpenChange(false)
    } catch (e: any) {
      toast.error(`Creazione fallita: ${e.message}`)
    } finally {
      setCreating(false)
    }
  }, [name, description, version, role, capabilities, selectedSkills, parentAgent, onCreated, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" />
            Create Agent
          </DialogTitle>
          <DialogDescription>
            Registra un nuovo agente persistente nel sistema. L'agente sarà disponibile per l'assegnazione nei task e nella pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Identity */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="es. Code Reviewer" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Version</Label>
                <Input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Description *</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Cosa fa questo agente? Quali task può eseguire?" rows={2} className="mt-1" />
            </div>
          </div>

          {/* Role & Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={(v: Role) => setRole(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">{ROLES.find(r => r.value === role)?.description}</p>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Cpu className="size-3" /> Model (optional)</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Auto (router)" /></SelectTrigger>
                <SelectContent>
                  {models.map(m => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.name} <span className="text-muted-foreground text-[10px] ml-1">({m.specialization})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                {modelId ? `Costo: $${models.find(m => m.modelId === modelId)?.costPer1kTokens || '?'}/1k tokens` : 'Il router sceglierà automaticamente'}
              </p>
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <Label className="text-xs">Capabilities</Label>
            <div className="flex gap-2 mt-1">
              <Input value={newCapability} onChange={e => setNewCapability(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapability() } }}
                placeholder="es. code-analysis" className="flex-1" />
              <Button size="sm" variant="outline" onClick={addCapability} disabled={!newCapability.trim()}>Add</Button>
            </div>
            {capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {capabilities.map(cap => (
                  <Badge key={cap} variant="secondary" className="text-[10px] gap-1">
                    {cap} <button onClick={() => removeCapability(cap)}><X className="size-2.5" /></button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div>
              <Label className="text-xs flex items-center gap-1"><Sparkles className="size-3" /> Skills</Label>
              <ScrollArea className="h-32 mt-1 border rounded-md">
                <div className="p-2 space-y-1">
                  {skills.map(s => (
                    <label key={s.uri} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer">
                      <input type="checkbox" checked={selectedSkills.includes(s.uri)}
                        onChange={() => toggleSkill(s.uri)}
                        className="mt-0.5 accent-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{s.name}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-1">{s.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Parent Agent */}
          {agents.length > 0 && (
            <div>
              <Label className="text-xs">Parent Agent (optional)</Label>
              <Select value={parentAgent} onValueChange={setParentAgent}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuno (root agent)</SelectItem>
                  {agents.map((a: any) => (
                    <SelectItem key={a.uri || a.id} value={a.uri || a.id}>
                      {a.name || a.identifier || a.uri || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim() || !description.trim()}>
            {creating ? <Loader2 className="size-4 animate-spin mr-1" /> : <UserPlus className="size-4 mr-1" />}
            Create Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
