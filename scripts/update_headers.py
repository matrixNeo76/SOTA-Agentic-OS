#!/usr/bin/env python3
"""
Aggiorna gli header delle 14 pagine di fase con PhaseHeader.
Pattern più flessibile: accetta qualsiasi nome di funzione refresh.
"""
import re
import os
import glob

PHASE_DIR = '/home/z/my-project/src/components/agentic'

def update_header(filename, phase_id):
    with open(filename, 'r') as f:
        content = f.read()
    original = content

    # Pattern header flessibile:
    # <div className="flex items-start justify-between gap-4 flex-wrap">
    #   <div>
    #     <h1 className="text-2xl font-bold flex items-center gap-2">
    #       <Icon className="size-6 text-primary" /> Fase N · ...
    #     </h1>
    #     <p className="text-sm text-muted-foreground mt-1">...</p>
    #   </div>
    #   <Button variant="outline" size="sm" onClick={ANY_NAME}>
    #     <RefreshCw className="size-3.5 mr-1.5" /> Aggiorna
    #   </Button>
    # </div>

    # Match multiline
    pattern = re.compile(
        r'<div className="flex items-start justify-between gap-4 flex-wrap">\s*'
        r'<div>\s*'
        r'<h1 className="text-2xl font-bold flex items-center gap-2">\s*'
        r'<[A-Za-z]+ className="size-6 text-primary" />\s*Fase \d+[^<]*</h1>\s*'
        r'<p className="text-sm text-muted-foreground mt-1">\s*[^<]*\s*</p>\s*'
        r'</div>\s*'
        r'<Button variant="outline" size="sm" onClick=\{(\w+)\}>\s*'
        r'<RefreshCw className="size-3\.5 mr-1\.5" />\s*Aggiorna\s*'
        r'</Button>\s*'
        r'</div>',
        re.DOTALL
    )

    match = pattern.search(content)
    if not match:
        print(f'  -- {filename}: pattern header non matchato')
        return False

    refresh_fn = match.group(1)
    replacement = (
        f'<PhaseHeader phaseId="{phase_id}" action={{'
        f'<Button variant="outline" size="sm" onClick={{{refresh_fn}}}>'
        f'<RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>'
        f'}} />'
    )

    content = content[:match.start()] + replacement + content[match.end():]

    if content != original:
        with open(filename, 'w') as f:
            f.write(content)
        print(f'  ✓ {filename}: header sostituito (refresh={refresh_fn})')
        return True
    return False


print('=== Sostituzione header ===\n')
for f in sorted(glob.glob(f'{PHASE_DIR}/phase*.tsx')):
    name = os.path.basename(f).replace('.tsx', '')
    update_header(f, name)
print('\n=== Completato ===')
