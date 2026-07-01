'use client'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { DomainHeader } from '../_shared/domain-header'
import { ContextualLinks } from '../_shared/contextual-links'
import { Phase1 } from '@/components/agentic/phase1'
import { Phase6 } from '@/components/agentic/phase6'
import { Phase10 } from '@/components/agentic/phase10'

export function MemoryContextDomain() {
 const [tab, setTab] = useState('episodic')
 return (
 <div className="p-4 md:p-6 space-y-4">
 <DomainHeader title="Memory & Context" subtitle="Memoria episodica · Context manager · Sessioni LLM" domain="inspect" />
 <Tabs value={tab} onValueChange={setTab} className="w-full">
 <TabsList className="grid w-full max-w-md grid-cols-3">
 <TabsTrigger value="episodic"><DynamicIcon name="Database" className="size-3.5 mr-1.5" />Episodic</TabsTrigger>
 <TabsTrigger value="context"><DynamicIcon name="Scissors" className="size-3.5 mr-1.5" />Context</TabsTrigger>
 <TabsTrigger value="sessions"><DynamicIcon name="Boxes" className="size-3.5 mr-1.5" />Sessions</TabsTrigger>
 </TabsList>
 <TabsContent value="episodic" className="mt-4"><Phase1 /></TabsContent>
 <TabsContent value="context" className="mt-4"><Phase6 /></TabsContent>
 <TabsContent value="sessions" className="mt-4"><Phase10 /></TabsContent>
 </Tabs>
 <ContextualLinks />
 </div>
 )
}
