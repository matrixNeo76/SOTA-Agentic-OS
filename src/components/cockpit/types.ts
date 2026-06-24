export type Narrative = { id: string; agentId: string; narrative: string; level: string; cycleId: number | null; relatedPhase: string | null; timestamp: string }
export type LogEntry = { id: string; agentId: string; phase: string; event: string; payload: string; level: string; timestamp: string }
export type SchedulerTask = { id: string; taskId: string; agentId: string; description: string; dependencies: string; status: string; plan: { taskGoal: string } }
export type CycleSnapshot = { id: string; cycleId: number; xmlContent: string; queueDepth: number; activeThreads: number; systemLoad: number; timestamp: string }
export type SteeringEvent = { id: string; cycleId: number; agentId: string; strategy: string; phrase: string; tokenBudget: number; tokenUsed: number; timestamp: string }
export type SafetyItem = { id: string; agentId: string; action: string; source: string; axiomTrail: string; readableExplanation: string; status: string; createdAt: string }
export type CockpitTab = 'narrative' | 'log' | 'scheduler' | 'cycles' | 'safety'
