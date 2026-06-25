import { LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles, Scissors, GitFork, FunctionSquare, UserCog, Boxes, HeartPulse, Target, Network, Shuffle, Gauge, Package, Terminal } from 'lucide-react'
export function DynamicIcon({ name, className }: { name: string; className?: string }) {
 switch (name) {
 case 'LayoutDashboard': return <LayoutDashboard className={className} />
 case 'Database': return <Database className={className} />
 case 'Workflow': return <Workflow className={className} />
 case 'Compass': return <Compass className={className} />
 case 'ShieldCheck': return <ShieldCheck className={className} />
 case 'Sparkles': return <Sparkles className={className} />
 case 'Scissors': return <Scissors className={className} />
 case 'GitFork': return <GitFork className={className} />
 case 'FunctionSquare': return <FunctionSquare className={className} />
 case 'UserCog': return <UserCog className={className} />
 case 'Boxes': return <Boxes className={className} />
 case 'HeartPulse': return <HeartPulse className={className} />
 case 'Target': return <Target className={className} />
 case 'Network': return <Network className={className} />
 case 'Shuffle': return <Shuffle className={className} />
 case 'Gauge': return <Gauge className={className} />
 case 'Package': return <Package className={className} />
 case 'Terminal': return <Terminal className={className} />
 default: return <LayoutDashboard className={className} />
 }
}
