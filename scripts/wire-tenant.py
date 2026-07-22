#!/usr/bin/env python3
"""Wire withTenant to critical API routes."""
import os

ROUTES_TO_UPDATE = [
    'src/app/api/console/route.ts',
    'src/app/api/cockpit/route.ts',
    'src/app/api/blocked-actions/route.ts',
    'src/app/api/cost/route.ts',
    'src/app/api/plan/route.ts',
    'src/app/api/sensorium/route.ts',
    'src/app/api/memory/route.ts',
    'src/app/api/patchboard/route.ts',
    'src/app/api/tools/route.ts',
]

for route_path in ROUTES_TO_UPDATE:
    if not os.path.exists(route_path):
        print(f"  ⏭️  {route_path} — not found")
        continue

    with open(route_path, 'r') as f:
        content = f.read()

    # Check if already has withTenant
    if 'withTenant' in content:
        print(f"  ⏭️  {route_path} — already has withTenant")
        continue

    # Add import
    if "from '@/lib/with-tenant'" not in content:
        # Find the last import line
        lines = content.split('\n')
        last_import = 0
        for i, line in enumerate(lines):
            if line.startswith('import '):
                last_import = i
        lines.insert(last_import + 1, "import { withTenantOrDefault } from '@/lib/with-tenant'")
        content = '\n'.join(lines)

    # Replace `export async function GET(req: NextRequest)` with wrapped version
    # and `export async function GET()` with `export async function GET(req: NextRequest)`
    content = content.replace(
        'export async function GET() {',
        'export async function GET(req: NextRequest) {\n  return withTenantOrDefault(req, async () => {'
    )
    content = content.replace(
        'export async function GET(req: NextRequest) {',
        'export async function GET(req: NextRequest) {\n  return withTenantOrDefault(req, async () => {'
    )
    content = content.replace(
        'export async function POST(req: NextRequest) {',
        'export async function POST(req: NextRequest) {\n  return withTenantOrDefault(req, async () => {'
    )

    # Add closing }) at the end of the file (before the last blank line)
    if content.rstrip().endswith('}'):
        content = content.rstrip() + '\n  })\n}\n'

    with open(route_path, 'w') as f:
        f.write(content)

    print(f"  ✅ {route_path} — wired withTenantOrDefault")

print("\nDone! Verify with: bun run lint")
