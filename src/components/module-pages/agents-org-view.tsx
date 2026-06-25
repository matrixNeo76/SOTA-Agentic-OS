'use client'

/**
 * Agents Org View — UX-2
 *
 * Area "Agents & Org": Mesh topology + Lifecycle + Skills + Autonomous Org
 */

import { useState, useEffect, useCallback } from 'react'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, Wrench, GitBranch, Activity } from 'lucide-react'

export function AgentsOrgView() {
  const [meshData, setMeshData] = useState<any>(null)
  const [skillData, setSkillData] = useState<any>(null)
  const [proposalData, setProposalData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [mesh, skills, proposals] = await Promise.all([
        fetch('/api/agent-mesh').then((r) => r.json()).catch(() => null),
        fetch('/api/skill-registry').then((r) => r.json()).catch(() => null),
        fetch('/api/autonomous-org').then((r) => r.json()).catch(() => null),
      ])
      setMeshData(mesh)
      setSkillData(skills)
      setProposalData(proposals)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const bootstrap = async () => {
    await fetch('/api/agent-mesh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bootstrap' }),
    })
    fetchData()
  }

  return (
    <ModulePage
      title="Agents & Organization"
      description="Mesh topology · Lifecycle · Skills · Autonomous Org"
      icon="Users"
      loading={loading}
      onRefresh={fetchData}
      actions={
        <Button size="sm" variant="outline" onClick={bootstrap}>
          <GitBranch className="w-4 h-4 mr-1" /> Bootstrap Mesh
        </Button>
      }
      stats={[
        { label: 'Agents', value: meshData?.stats?.totalAgents ?? 0, icon: 'Users' },
        { label: 'Skills', value: skillData?.stats?.total ?? 0, icon: 'Wrench' },
        { label: 'Pending Proposals', value: proposalData?.stats?.pendingApproval ?? 0, tone: 'warn' as const, icon: 'Activity' },
        { label: 'Executed', value: proposalData?.stats?.executed ?? 0, icon: 'Check' },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Mesh Topology */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4" /> Agent Mesh Topology
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meshData?.topology?.nodes?.length > 0 ? (
              <div className="space-y-2">
                {(['executive', 'strategic', 'operational', 'specialized'] as const).map((tier) => {
                  const agents = meshData.topology.nodes.filter((n: any) => n.tier === tier)
                  if (agents.length === 0) return null
                  return (
                    <div key={tier} className="border rounded p-2">
                      <div className="text-xs font-semibold capitalize mb-1 text-muted-foreground">{tier}</div>
                      <div className="flex flex-wrap gap-1">
                        {agents.map((a: any) => (
                          <Badge key={a.agentUri} variant="outline" className="text-xs">
                            {a.agentUri.replace('agent://', '')}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                icon="Users"
                title="No agents"
                description="Bootstrap the default mesh to create 10 agents across 3 tiers"
                action={<Button size="sm" variant="outline" onClick={bootstrap}>Bootstrap</Button>}
              />
            )}
          </CardContent>
        </Card>

        {/* Skills Registry */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench className="w-4 h-4" /> Skill Registry
            </CardTitle>
          </CardHeader>
          <CardContent>
            {skillData?.skills?.length > 0 ? (
              <div className="space-y-1 max-h-64 overflow-auto">
                {skillData.skills.slice(0, 10).map((s: any) => (
                  <div key={s.uri} className="border rounded p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant={s.lifecycleState === 'active' ? 'success' : 'secondary'}>{s.lifecycleState}</Badge>
                    </div>
                    <div className="text-muted-foreground truncate mt-0.5">{s.description}</div>
                    {s.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {s.tags.slice(0, 3).map((t: string) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="Wrench"
                title="No skills registered"
                description="Seed default skills or create new ones via the Admin panel"
              />
            )}
          </CardContent>
        </Card>

        {/* Autonomous Org Proposals */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" /> Autonomous Org — Pending Proposals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proposalData?.pending?.length > 0 ? (
              <div className="space-y-2">
                {proposalData.pending.slice(0, 5).map((p: any) => (
                  <div key={p.uri} className="flex items-start justify-between border rounded p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{p.type}</Badge>
                        <span className="text-sm font-medium">{p.description}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{p.rationale}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="default" onClick={async () => {
                        await fetch('/api/autonomous-org', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'approve', proposalUri: p.uri, approvedBy: 'user://admin' }),
                        })
                        fetchData()
                      }}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={async () => {
                        await fetch('/api/autonomous-org', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'reject', proposalUri: p.uri, rejectedBy: 'user://admin', reason: 'Rejected via UI' }),
                        })
                        fetchData()
                      }}>Reject</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="Activity"
                title="No pending proposals"
                description="The system is stable — no autonomous actions require approval"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </ModulePage>
  )
}
