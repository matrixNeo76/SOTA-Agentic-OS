'use client'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { DomainHeader } from '../_shared/domain-header'
import { ContextualLinks } from '../_shared/contextual-links'
import { Phase2 } from '@/components/agentic/phase2'
import { Phase3 } from '@/components/agentic/phase3'
import { Phase12 } from '@/components/agentic/phase12'

export function PlanExecuteDomain() {
 const [tab, setTab] = useState('planner')
 return (
 <div className="p-4 md:p-6 space-y-4">
 <DomainHeader title="Plan & Execute" subtitle="DynAMO planner · Steering ACTS · Objective tree" domain="inspect" />
 <Tabs value={tab} onValueChange={setTab} className="w-full">
 <TabsList className="grid w-full max-w-md grid-cols-3">
 <TabsTrigger value="planner"><DynamicIcon name="Workflow" className="size-3.5 mr-1.5" />Planner</TabsTrigger>
 <TabsTrigger value="steering"><DynamicIcon name="Compass" className="size-3.5 mr-1.5" />Steering</TabsTrigger>
 <TabsTrigger value="objective"><DynamicIcon name="Target" className="size-3.5 mr-1.5" />Objective</TabsTrigger>
 </TabsList>
 <TabsContent value="planner" className="mt-4"><Phase2 /></TabsContent>
 <TabsContent value="steering" className="mt-4"><Phase3 /></TabsContent>
 <TabsContent value="objective" className="mt-4"><Phase12 /></TabsContent>
 </Tabs>
 <ContextualLinks />
 </div>
 )
}
