'use client'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { DomainHeader } from '../_shared/domain-header'
import { ContextualLinks } from '../_shared/contextual-links'
import { Phase5 } from '@/components/agentic/phase5'
import { Phase11 } from '@/components/agentic/phase11'
import { Phase14 } from '@/components/agentic/phase14'
import { Phase9 } from '@/components/agentic/phase9'

export function LearnRouteDomain() {
 const [tab, setTab] = useState('reflect')
 return (
 <div className="p-4 md:p-6 space-y-4">
 <DomainHeader title="Learn & Route" subtitle="Reflective learning · Affect monitor · Model router · Human retainer" domain="inspect" />
 <Tabs value={tab} onValueChange={setTab} className="w-full">
 <TabsList className="grid w-full max-w-2xl grid-cols-4">
 <TabsTrigger value="reflect"><DynamicIcon name="Sparkles" className="size-3.5 mr-1.5" />Reflect</TabsTrigger>
 <TabsTrigger value="affect"><DynamicIcon name="HeartPulse" className="size-3.5 mr-1.5" />Affect</TabsTrigger>
 <TabsTrigger value="router"><DynamicIcon name="Shuffle" className="size-3.5 mr-1.5" />Router</TabsTrigger>
 <TabsTrigger value="retainer"><DynamicIcon name="UserCog" className="size-3.5 mr-1.5" />Retainer</TabsTrigger>
 </TabsList>
 <TabsContent value="reflect" className="mt-4"><Phase5 /></TabsContent>
 <TabsContent value="affect" className="mt-4"><Phase11 /></TabsContent>
 <TabsContent value="router" className="mt-4"><Phase14 /></TabsContent>
 <TabsContent value="retainer" className="mt-4"><Phase9 /></TabsContent>
 </Tabs>
 <ContextualLinks />
 </div>
 )
}
