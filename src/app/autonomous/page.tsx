/**
 * /autonomous — Autonomous Organization Dashboard page
 *
 * Espone il cockpit Fase 4.3 per visualizzare:
 *   - Mesh gerarchica
 *   - World Model
 *   - Autonomous Org proposals
 *   - Digital Twin scenarios
 *   - Skill Registry + Synthesis
 *   - Conflict Resolution
 *   - Cognitive GC
 */

import { AutonomousDashboard } from '@/components/autonomous-dashboard/autonomous-dashboard'

export default function AutonomousPage() {
  return (
    <main className="container mx-auto p-6 max-w-7xl">
      <AutonomousDashboard />
    </main>
  )
}
