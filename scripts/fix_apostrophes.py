#!/usr/bin/env python3
"""Fix apostrofi nelle stringhe RelatedPhases - sostituisce ' con escape \'"""
import re
import os
import glob

PHASE_DIR = '/home/z/my-project/src/components/agentic'

for f in sorted(glob.glob(f'{PHASE_DIR}/phase*.tsx')):
    with open(f, 'r') as fh:
        content = fh.read()
    original = content

    # Pattern: trova tutte le chiamate link('phaseN', 'label', 'reason con apostrofi')
    # e fa escape degli apostrofi dentro reason
    def fix_link_match(m):
        full = m.group(0)
        phase = m.group(1)
        label = m.group(2)
        reason = m.group(3)
        # Escape apostrofi in reason (non il delimitatore)
        fixed_reason = reason.replace("'", "\\'")
        # Idem per label
        fixed_label = label.replace("'", "\\'")
        return f"link('{phase}', '{fixed_label}', '{fixed_reason}')"

    # Pattern: link('phaseN', 'label', 'reason')
    # reason può contenere qualsiasi carattere eccetto ') che chiude
    pattern = re.compile(r"link\('(\w+)',\s*'([^']+)',\s*'([^']+)'\)")
    content = pattern.sub(fix_link_match, content)

    if content != original:
        with open(f, 'w') as fh:
            fh.write(content)
        print(f'  ✓ {os.path.basename(f)}')
