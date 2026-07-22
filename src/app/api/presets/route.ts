/**
 * API: /api/presets — Sector Presets management
 *
 * GET  — list all available presets
 * POST action='apply'     — apply preset to current org
 * POST action='get'       — get preset details
 * POST action='initialize'— seed presets in DB (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listPresets, getPreset, applyPreset, initializePresets, PRESET_DEFINITIONS } from '@/lib/kernel/sector-presets'

export const runtime = 'nodejs'

export async function GET() {
  const presets = await listPresets()
  return NextResponse.json({ presets })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || !session.user.active) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const body = await req.json()
  const { action } = body

  // === Initialize presets in DB ===
  if (action === 'initialize') {
    await initializePresets()
    return NextResponse.json({ ok: true, count: PRESET_DEFINITIONS.length })
  }

  // === Apply preset to organization ===
  if (action === 'apply') {
    const { presetName } = body
    if (!presetName) return NextResponse.json({ error: 'presetName required' }, { status: 400 })

    try {
      await applyPreset(session.user.organizationId, presetName)
      return NextResponse.json({ ok: true, preset: presetName })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Get preset details ===
  if (action === 'get') {
    const { presetName } = body
    const preset = await getPreset(presetName)
    if (!preset) return NextResponse.json({ error: 'Preset not found' }, { status: 404 })
    return NextResponse.json({ preset })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}
