export type Narrative = { id: string; agentId: string; narrative: string; level: string; cycleId: string | null; relatedPhase: string | null; timestamp: string }
export type LogEntry = { id: string; agentId: string; phase: string; event: string; payload: string; level: string; timestamp: string }
export type SchedulerTask = { id: string; taskId: string; agentId: string; description: string; dependencies: string; status: string; plan: { taskGoal: string } }
export type CycleSnapshot = { id: string; cycleId: string; xmlContent: string; queueDepth: number; activeThreads: number; systemLoad: number; timestamp: string }
// C3 fix (Fase B) — SteeringEvent.cycleId ora String (cuid), non più Int
export type SteeringEvent = { id: string; cycleId: string; agentId: string; strategy: string; phrase: string; tokenBudget: number; tokenUsed: number; timestamp: string; planId: string | null; step: number }
export type SafetyItem = { id: string; agentId: string; action: string; source: string; axiomTrail: string; readableExplanation: string; status: string; createdAt: string }
export type CockpitTab = 'narrative' | 'log' | 'scheduler' | 'cycles' | 'safety'
