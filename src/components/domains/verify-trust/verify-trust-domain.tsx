'use client'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { DomainHeader } from '../_shared/domain-header'
import { ContextualLinks } from '../_shared/contextual-links'
import { Phase4 } from '@/components/agentic/phase4'
import { Phase7 } from '@/components/agentic/phase7'
import { Phase8 } from '@/components/agentic/phase8'
import { Phase13 } from '@/components/agentic/phase13'

export function VerifyTrustDomain() {
  const [tab, setTab] = useState('ltl')
  return (
    <div className="p-4 md:p-6 space-y-4">
      <DomainHeader title="Verify & Trust" subtitle="LTL & Taint · Trace validator · Lean4 · Swarm quorum" domain="inspect" />
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="ltl"><DynamicIcon name="ShieldCheck" className="size-3.5 mr-1.5" />LTL</TabsTrigger>
          <TabsTrigger value="trace"><DynamicIcon name="GitFork" className="size-3.5 mr-1.5" />Trace</TabsTrigger>
          <TabsTrigger value="lean"><DynamicIcon name="FunctionSquare" className="size-3.5 mr-1.5" />Lean</TabsTrigger>
          <TabsTrigger value="swarm"><DynamicIcon name="Network" className="size-3.5 mr-1.5" />Swarm</TabsTrigger>
        </TabsList>
        <TabsContent value="ltl" className="mt-4"><Phase4 /></TabsContent>
        <TabsContent value="trace" className="mt-4"><Phase7 /></TabsContent>
        <TabsContent value="lean" className="mt-4"><Phase8 /></TabsContent>
        <TabsContent value="swarm" className="mt-4"><Phase13 /></TabsContent>
      </Tabs>
      <ContextualLinks />
    </div>
  )
}
