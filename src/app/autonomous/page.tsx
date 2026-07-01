/**
 * /autonomous — Autonomous Organization Dashboard page
 *
 * Espone il cockpit Fase 4.3 + Fase 5.5 per visualizzare:
 *   - Mesh gerarchica
 *   - World Model
 *   - Autonomous Org proposals
 *   - Digital Twin scenarios (Fase 5.5)
 *   - Conflict Resolution queue (Fase 5.5)
 *   - Skill Registry + Synthesis
 *   - Cognitive GC
 */

import { AutonomousDashboard } from '@/components/autonomous-dashboard/autonomous-dashboard'
import { DigitalTwinDashboard } from '@/components/autonomous-dashboard/digital-twin-panel'
import { ConflictQueuePanel } from '@/components/autonomous-dashboard/conflict-queue-panel'

export default function AutonomousPage() {
  return (
    <main className="container mx-auto p-6 max-w-7xl space-y-8">
      <AutonomousDashboard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DigitalTwinDashboard />
        <ConflictQueuePanel />
      </div>
    </main>
  )
}
