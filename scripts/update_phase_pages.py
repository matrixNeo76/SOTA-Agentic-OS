#!/usr/bin/env python3
"""
Aggiorna tutte le 14 pagine di fase con:
1. Header uniforme (PhaseHeader) invece dell'h1 personalizzato
2. Pannello RelatedPhases in fondo

Approccio: per ogni file, individua il blocco header esistente e lo sostituisce
con <PhaseHeader phaseId="phaseN" action={...} />, e aggiunge <RelatedPhases links={links} />
prima della chiusura del div principale.
"""
import re
import os

PHASE_DIR = '/home/z/my-project/src/components/agentic'

# Definizione dei link tra fasi (basata sui 6 flussi architetturali)
RELATED_LINKS = {
    'phase1': [
        ('phase6', 'Gestisci contesto', 'Le osservazioni episodiche alimentano il ring buffer del Context Manager'),
        ('phase13', 'Sincronizza belief', 'Replica le convinzioni semantiche tra agenti paralleli'),
        ('phase3', 'Ciclo cognitivo', 'Il Sensorium alimenta lo steering ACTS'),
        ('phase5', 'Rifletti', 'Dalla memoria episodica estrai euristiche ERL'),
    ],
    'phase2': [
        ('phase8', 'Verifica formalmente', 'Traduci il DAG in contratti Lean4 e verifica pre/post conditions'),
        ('phase7', 'Valida traccia', 'Confronta l\'esecuzione del piano con tracce PTA'),
        ('phase5', 'Rifletti su esito', 'Dopo il piano, estrai euristiche dall\'esperienza'),
        ('phase9', 'Richiedi approvazione', 'Azioni del piano irreversibili richiedono HITL gate'),
    ],
    'phase3': [
        ('phase1', 'Stato & memoria', 'Lo steering consulta stato globale e Sensorium'),
        ('phase10', 'Modello incapsulato', 'Le steering phrases vengono iniettate nel Model Encapsulator'),
        ('phase14', 'Route steering', 'Le decisioni PLAN/EXECUTE possono usare modelli specializzati'),
        ('phase11', 'Monitora affetti', 'Le sterzate ripetute aumentano la frustrazione'),
    ],
    'phase4': [
        ('phase9', 'Cancello normativo', 'Le violazioni LTL bloccanti richiedono Audit Ledger'),
        ('phase8', 'Verifica formale', 'LTL runtime + Lean4 pre-execution formano trust stratificato'),
        ('phase11', 'Affect monitor', 'I gate rejects aumentano la disperazione dell\'agente'),
        ('phase13', 'Quorum semantico', 'Le decisioni LTL possono richiedere quorum swarm'),
    ],
    'phase5': [
        ('phase2', 'Applica a nuovo piano', 'Le euristiche ERL vengono iniettate nel prompt di pianificazione'),
        ('phase8', 'LeanEvolve', 'Le euristiche guidano il recovery dei workflow falliti'),
        ('phase12', 'Valuta obiettivo', 'Le euristiche valutano i nodi della rubric tree'),
        ('phase1', 'Memorizza in NS-Mem', 'Le euristiche sono entità semantiche con embedding'),
    ],
    'phase6': [
        ('phase1', 'Fonte: Sensorium', 'Il contesto riassemblato è iniettato dal Curator (Fase 1)'),
        ('phase10', 'Encapsulated call', 'Il working context alimenta il Model Encapsulator'),
        ('phase14', 'Routing basato su size', 'La lunghezza del contesto influenza il Model Router'),
        ('phase3', 'Steering aware', 'Le sterzate ACTS consumano contesto working memory'),
    ],
    'phase7': [
        ('phase2', 'Tracce da piano', 'Le esecuzioni dei piani DynAMO generano tracce da validare'),
        ('phase8', 'Verifica formale', 'Le tracce valide possono essere certificate formalmente'),
        ('phase12', 'Confronta con rubric', 'Le tracce Pass/Fail allineano con la rubric tree'),
        ('phase9', 'Audit esecuzione', 'Le esecuzioni validate diventano voci Audit Ledger'),
    ],
    'phase8': [
        ('phase2', 'Verifica piano DynAMO', 'I contratti formali derivano dal DAG della Fase 2'),
        ('phase5', 'LeanEvolve → ERL', 'Dopo evolve, rifletti sull\'esperienza di recovery'),
        ('phase7', 'Valida post-evolve', 'Dopo LeanEvolve, valida l\'esecuzione con dominator trees'),
        ('phase4', 'Verifica runtime LTL', 'Lean4 pre-execution + LTL runtime formano trust stratificato'),
    ],
    'phase9': [
        ('phase4', 'Policy LTL', 'I gate HITL scattano anche su violazioni LTL'),
        ('phase11', 'Affect-driven gates', 'Disperazione alta stringe i gate di approvazione'),
        ('phase13', 'Quorum come delega', 'Il quorum semantico può sostituire HITL singolo'),
        ('phase2', 'Approva piano', 'I piani DynAMO irreversibili richiedono HITL'),
    ],
    'phase10': [
        ('phase6', 'Working context', 'Il contesto minimale deriva dal Context Manager'),
        ('phase14', 'Route modello', 'L\'encapsulator può usare il TimeRouter per scegliere il modello'),
        ('phase3', 'Steering injection', 'Le steering phrases sono iniettate nelle chiamate incapsulate'),
        ('phase4', 'Sandbox verificata', 'Gli script di parsing sono validati come Compiled AI (Fase 2)'),
    ],
    'phase11': [
        ('phase4', 'Fonte: gate rejects', 'I rifiuti LTL/Taint alimentano la disperazione'),
        ('phase9', 'Interventi → HITL', 'Il Meta-Observer può forzare gate HITL'),
        ('phase3', 'HALT steering', 'Gli interventi HALT fermano il ciclo cognitivo'),
        ('phase5', 'Rifletti su stress', 'Le metriche affettive alimentano euristiche ERL'),
    ],
    'phase12': [
        ('phase2', 'Piano da obiettivo', 'La rubric tree guida la generazione del piano DynAMO'),
        ('phase5', 'Euristiche di valutazione', 'I nodi Pass/Fail usano euristiche ERL'),
        ('phase7', 'Tracce di valutazione', 'Le esecuzioni validate producono tracce per PTA'),
        ('phase8', 'Verifica formale', 'I nodi foglia possono avere contratti Lean4'),
    ],
    'phase13': [
        ('phase2', 'Join dei piani', 'Il quorum semantico è il meccanismo di Join dei DAG'),
        ('phase1', 'Replica in memoria', 'I belief sincronizzati diventano entità semantiche'),
        ('phase5', 'Riflessione swarm', 'I conflitti ESR attivano riflessione ERL'),
        ('phase9', 'Quorum = delega multipla', 'Il quorum sostituisce HITL singolo per azioni delegate'),
    ],
    'phase14': [
        ('phase10', 'Encapsulator consumer', 'Il Model Encapsulator usa il modello scelto dal router'),
        ('phase3', 'Steering model choice', 'Le strategie ACTS possono usare modelli diversi'),
        ('phase11', 'Affect influences routing', 'Disperazione alta può forzare ensemble (più cautela)'),
        ('phase4', 'Safety routing', 'Modelli per task sensibili sono validati da LTL/Taint'),
    ],
}

# Pattern: header personalizzato da sostituire
# Tipicamente è un <div> con h1 e un bottone "Aggiorna"
# Cercaamo il pattern "Fase N ·" nel h1

def make_related_links(phase_id):
    """Genera il codice TS per i RelatedLinks di una fase."""
    links = RELATED_LINKS.get(phase_id, [])
    if not links:
        return '[]'
    items = []
    for target, label, reason in links:
        items.append(f'link(\'{target}\', \'{label}\', \'{reason}\')')
    return '[' + ', '.join(items) + ']'


def update_phase_file(phase_id, file_num):
    """Aggiorna un singolo file phaseN.tsx."""
    filename = f'{PHASE_DIR}/phase{file_num}.tsx'
    if not os.path.exists(filename):
        print(f'  SKIP {filename} (non esiste)')
        return False

    with open(filename, 'r') as f:
        content = f.read()

    original = content

    # 1. Aggiungi import PhaseHeader e RelatedPhases + link se mancante
    if 'PhaseHeader' not in content:
        # Trova l'ultimo import
        import_match = re.search(r"(import [^\n]+ from '[^\n]+'\n)(?=\n|[^\n]*[^'])", content)
        if import_match:
            insert_pos = import_match.end()
            # Trova l'ultimo import effettivo
            imports = re.findall(r"import [^\n]+ from '[^\n]+'\n", content)
            if imports:
                last_import = imports[-1]
                insert_pos = content.find(last_import) + len(last_import)
                new_imports = (
                    "import { PhaseHeader } from './phase-header'\n"
                    "import { RelatedPhases, link } from './related-phases'\n"
                )
                content = content[:insert_pos] + new_imports + content[insert_pos:]

    # 2. Sostituisci header personalizzato con <PhaseHeader phaseId=... />
    # Pattern tipico:
    # <div className="flex items-start justify-between gap-4 flex-wrap">
    #   <div>
    #     <h1 className="text-2xl font-bold flex items-center gap-2">
    #       <Icon className="size-6 text-primary" /> Fase N · Description
    #     </h1>
    #     <p className="text-sm text-muted-foreground mt-1">...</p>
    #   </div>
    #   <Button variant="outline" size="sm" onClick={refresh}>
    #     <RefreshCw className="size-3.5 mr-1.5" /> Aggiorna
    #   </Button>
    # </div>

    header_pattern = re.compile(
        r'<div className="flex items-start justify-between gap-4 flex-wrap">\s*'
        r'<div>\s*'
        r'<h1 className="text-2xl font-bold flex items-center gap-2">\s*'
        r'<[A-Za-z]+ className="size-6 text-primary" />\s*Fase \d+[^<]*</h1>\s*'
        r'<p className="text-sm text-muted-foreground mt-1">[^<]*</p>\s*'
        r'</div>\s*'
        r'<Button variant="outline" size="sm" onClick=\{refresh\}>\s*'
        r'<RefreshCw className="size-3\.5 mr-1\.5" />\s*Aggiorna\s*'
        r'</Button>\s*'
        r'</div>'
    )
    replacement = f'<PhaseHeader phaseId="{phase_id}" action={{<Button variant="outline" size="sm" onClick={{refresh}}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>}} />'
    content = header_pattern.sub(replacement, content)

    # 3. Aggiungi <RelatedPhases links={links} /> prima dell'ultimo </div> (chiusura del container)
    if 'RelatedPhases' not in content.split('export function')[1]:
        # Costruisci il blocco RelatedPhases
        links_code = make_related_links(phase_id)
        related_block = f'\n      <RelatedPhases links={{{links_code}}} />\n'

        # Trova l'ultimo </div> prima di "}" che chiude la funzione
        # Pattern: </div>\n    </div>\n  )\n}
        # Cerchiamo l'ultimo "</Tabs>" o "</div>" seguito da "  )\n}"
        end_pattern = re.compile(r'(\s*</Tabs>\n|\s*</div>\n)\s*\)\n\}', re.DOTALL)
        match = end_pattern.search(content)
        if match:
            insert_pos = match.start()
            # Indenta correttamente
            content = content[:insert_pos] + related_block + content[insert_pos:]

    if content != original:
        with open(filename, 'w') as f:
            f.write(content)
        print(f'  ✓ {filename} aggiornato')
        return True
    else:
        print(f'  -- {filename} nessun cambiamento (pattern non matchato)')
        return False


print('=== Aggiornamento 14 pagine di fase ===\n')
phase_to_file = {
    'phase1': 1, 'phase2': 2, 'phase3': 3, 'phase4': 4, 'phase5': 5,
    'phase6': 6, 'phase7': 7, 'phase8': 8, 'phase9': 9, 'phase10': 10,
    'phase11': 11, 'phase12': 12, 'phase13': 13, 'phase14': 14,
}
for phase_id, file_num in phase_to_file.items():
    update_phase_file(phase_id, file_num)
print('\n=== Completato ===')
