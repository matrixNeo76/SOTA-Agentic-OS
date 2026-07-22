#!/usr/bin/env python3
"""Add organizationId to all Prisma models that don't have it. Preserves closing braces."""
import re

SCHEMA_PATH = '/home/z/my-project/prisma/schema.prisma'
SKIP = {'Organization', 'Workspace', 'UserWorkspace', 'User', 'Session'}

with open(SCHEMA_PATH, 'r') as f:
    lines = f.readlines()

result = []
i = 0
count = 0

while i < len(lines):
    line = lines[i]
    result.append(line)
    
    match = re.match(r'^model\s+(\w+)\s*\{', line)
    if match:
        model_name = match.group(1)
        i += 1
        model_lines = []
        has_org_id = False
        
        # Collect all lines INCLUDING the closing brace
        while i < len(lines):
            if lines[i].strip() == '}':
                break
            if 'organizationId' in lines[i]:
                has_org_id = True
            model_lines.append(lines[i])
            i += 1
        
        if model_name not in SKIP and not has_org_id and model_lines:
            # Find insertion point: before first @@ line, or at end
            insert_idx = len(model_lines)
            for j in range(len(model_lines)):
                if model_lines[j].strip().startswith('@@'):
                    insert_idx = j
                    break
            
            model_lines.insert(insert_idx, '  organizationId String   @default("default") // Track 2.2 multi-tenant\n')
            model_lines.insert(insert_idx + 1, '  @@index([organizationId])\n')
            count += 1
        
        # Add model body lines
        for ml in model_lines:
            result.append(ml)
        # Add closing brace (the line that caused the while to break)
        if i < len(lines) and lines[i].strip() == '}':
            result.append(lines[i])
    
    i += 1

with open(SCHEMA_PATH, 'w') as f:
    f.writelines(result)

print(f'Added organizationId to {count} models')
