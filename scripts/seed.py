#!/usr/bin/env python3
"""
Seed diretto via sqlite3 per aggirare il client Prisma cached che ha
un file descriptor stale sul DB eliminato.
"""
import sqlite3
import json
import os
import time
from datetime import datetime, timezone

DB = '/home/z/my-project/db/custom.db'

def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')

def cuid():
    return f"seed-{int(time.time()*1000)}-{os.urandom(4).hex()}"

conn = sqlite3.connect(DB)
conn.execute('PRAGMA foreign_keys = ON')
cur = conn.cursor()

tables = ['EpisodicMemory','SemanticEntity','LogicalRule','PatchTransaction','GlobalState',
          'SensoriumSnapshot','AgentPlan','PlanTask','CompiledArtifact','CompiledTemplate',
          'SteeringEvent','SteeringStrategy','LTLRule','VerificationEvent','TaintRecord',
          'NormativeRule','Heuristic','RedLine','ReflectionLog','AgentLog']
for t in tables:
    try:
        cur.execute(f'DELETE FROM "{t}"')
    except Exception as e:
        print(f"skip {t}: {e}")
conn.commit()

# FASE 1: GlobalState
cur.execute("INSERT INTO GlobalState (id, key, value, schemaRef, updatedAt) VALUES (?,?,?,?,?)",
            (cuid(), 'system', json.dumps({'status': 'running', 'version': '0.1.0'}), None, now_iso()))
cur.execute("INSERT INTO GlobalState (id, key, value, schemaRef, updatedAt) VALUES (?,?,?,?,?)",
            (cuid(), 'metrics', json.dumps({'cycles': 0, 'tokensUsed': 0}), None, now_iso()))
cur.execute("INSERT INTO GlobalState (id, key, value, schemaRef, updatedAt) VALUES (?,?,?,?,?)",
            (cuid(), 'agents', json.dumps([
                {'id': 'orchestrator', 'role': 'coordination', 'status': 'idle'},
                {'id': 'curator', 'role': 'sensorium', 'status': 'active'},
                {'id': 'controller', 'role': 'steering', 'status': 'active'},
                {'id': 'verifier', 'role': 'ltl_monitor', 'status': 'active'},
                {'id': 'reflective', 'role': 'erl', 'status': 'idle'},
            ]), None, now_iso()))
cur.execute("INSERT INTO GlobalState (id, key, value, schemaRef, updatedAt) VALUES (?,?,?,?,?)",
            (cuid(), 'public', json.dumps({'note': 'hello'}), None, now_iso()))

for path, op, actor, value in [
    ('/system', 'add', 'kernel', {'status': 'running', 'version': '0.1.0'}),
    ('/metrics', 'add', 'curator', {'cycles': 0, 'tokensUsed': 0}),
    ('/agents', 'add', 'orchestrator', []),
    ('/public', 'add', 'kernel', {'note': 'hello'}),
]:
    cur.execute("""INSERT INTO PatchTransaction
        (id, path, op, value, actor, authorized, status, reason, snapshot, createdAt)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (cuid(), path, op, json.dumps(value), actor, 1, 'accepted', 'bootstrap', None, now_iso()))

episodes = [
    ('Sistema avviato: kernel caricato, 5 agenti registrati', 'kernel', 'kernel', ['boot']),
    ('Curator ha compilato il primo Sensorium XML', 'curator', 'curator', ['sensorium']),
    ('Verificatore LTL inizializzato con 4 regole di default', 'verifier', 'verifier', ['ltl']),
    ('Pool di thread paralleli pronto (max 4)', 'orchestrator', 'orchestrator', ['scheduler']),
]
for obs, src, agent, tags in episodes:
    cur.execute("""INSERT INTO EpisodicMemory
        (id, timestamp, observation, embedding, decay, source, agentId, tags)
        VALUES (?,?,?,?,?,?,?,?)""",
        (cuid(), now_iso(), obs, json.dumps([0.1]*128), 1.0, src, agent, json.dumps(tags)))

entities = [
    ('Sistema Operativo Agentico', 'system', 'OS distribuito per agenti LLM con memoria persistente'),
    ('PatchBoard', 'module', 'Kernel transazionale per stato JSON condiviso'),
    ('NS-Mem', 'module', 'Sistema memoria a 3 livelli: episodico, semantico, logico'),
    ('Sensorium', 'module', 'Blocco XML con stato operativo per ogni ciclo cognitivo'),
    ('DynAMO', 'module', 'Pianificatore vincolato da JSON-Schema con DAG topologico'),
    ('CompiledAI', 'module', 'Pipeline di generazione e validazione codice 4-stadi'),
    ('ACTS', 'module', 'Steering Controller per Chain-of-Thought guidato'),
    ('AgentVerify', 'module', 'Monitor LTL/FSM per verifica formale runtime'),
    ('TaintTracker', 'module', 'Tracciamento input tainted per prevenzione MitE'),
    ('NormativeGate', 'module', 'Cancello di output basato su gerarchia assiomatica'),
    ('ERL', 'module', 'Experiential Reflective Learning con estrazione euristiche'),
    ('AutoSOTA', 'module', 'Supervisore Red Line per evoluzione controllata'),
]
for name, type_, desc in entities:
    cur.execute("""INSERT INTO SemanticEntity
        (id, name, type, embedding, description, attributes, decay, updatedAt, createdAt)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (cuid(), name, type_, json.dumps([0.2]*128), desc, None, 1.0, now_iso(), now_iso()))

rules = [
    ('R1', 'produce_sensorium()', [], 1),
    ('R2', 'plan_task(goal)', [], 2),
    ('R3', 'schedule_dag(plan)', ['R2'], 2),
    ('R4', 'execute_task(t)', ['R3'], 3),
    ('R5', 'verify_event(event)', ['R4'], 3),
    ('R6', 'reflect(outcome)', ['R4', 'R5'], 4),
]
for rid, expr, deps, pri in rules:
    cur.execute("""INSERT INTO LogicalRule
        (id, ruleId, expression, dependencies, priority, active, createdAt)
        VALUES (?,?,?,?,?,?,?)""",
        (cuid(), rid, expr, json.dumps(deps), pri, 1, now_iso()))

templates = [
    ('compliance_check', 'Compliance Check', 'Valida che un input rispetti regole di compliance',
     'return input.status === "approved" && input.signature != null;'),
    ('authz_decision', 'Authorization Decision', 'Decide se autorizzare un\'azione basandosi su ruolo e scope',
     'return input.role === "admin" || input.scopes.includes("write");'),
    ('risk_score', 'Risk Scoring', 'Calcola un punteggio di rischio 0-100 da una request',
     'return Math.min(100, input.attempts * 10 + (input.geo !== "IT" ? 30 : 0));'),
]
for tid, name, desc, skel in templates:
    cur.execute("""INSERT INTO CompiledTemplate
        (id, templateId, name, description, skeleton, schemaJson, createdAt)
        VALUES (?,?,?,?,?,?,?)""",
        (cuid(), tid, name, desc, skel, json.dumps({'type':'object'}), now_iso()))

strategies = [
    ('PLAN', 'Prima di procedere, strutturiamo un piano esplicito in passaggi numerati.',
     'Forza la decomposizione del task in sotto-obiettivi ordinati.', 80),
    ('EXECUTE', 'Ora esegui il prossimo passo del piano, mostrando l\'output intermedio.',
     'Innesca l\'esecuzione concreta del prossimo step pianificato.', 120),
    ('CHECK', 'Aspetta, lasciami verificare: il risultato parziale e coerente con i vincoli?',
     'Attiva una fase di auto-verifica sui risultati intermedi.', 60),
    ('REFLECT', 'Rifletti su cosa ha funzionato e cosa migliorare, poi proponi una regola.',
     'Attiva la modalita riflessiva per estrarre euristiche.', 100),
    ('HALT', 'Stop: budget esaurito o soglia di sicurezza raggiunta.',
     'Ferma il ciclo cognitivo per budget o policy.', 0),
]
for name, phrase, desc, cost in strategies:
    cur.execute("""INSERT INTO SteeringStrategy
        (id, name, triggerPhrase, description, budgetCost, active)
        VALUES (?,?,?,?,?,?)""",
        (cuid(), name, phrase, desc, cost, 1))

ltl_rules = [
    ('LTL-001', 'G(high_risk -> X human_approval)',
     'Ogni tool call ad alto rischio richiede approvazione umana nel passo successivo', 'block'),
    ('LTL-002', 'G(tainted -> !sensitive_call)',
     'Un dato tainted non puo mai raggiungere una chiamata di sistema sensibile', 'block'),
    ('LTL-003', 'G(check -> X execute)',
     'Dopo un CHECK deve seguire un EXECUTE (no loop infiniti di verifica)', 'warn'),
    ('LTL-004', 'G(error -> F reflect)',
     'Dopo un errore deve eventualmente seguire una riflessione', 'warn'),
    ('LTL-005', 'F(halt || success)',
     'Ogni esecuzione deve eventualmente terminare (halt o success)', 'warn'),
    ('LTL-006', 'G(plan -> F execute)',
     'Dopo un PLAN deve eventualmente seguire un EXECUTE (nessun piano sterile)', 'warn'),
]
for rid, formula, desc, sev in ltl_rules:
    cur.execute("""INSERT INTO LTLRule
        (id, ruleId, ltlFormula, description, severity, active, createdAt)
        VALUES (?,?,?,?,?,?,?)""",
        (cuid(), rid, formula, desc, sev, 1, now_iso()))

axioms = [
    ('Non divulgare mai dati personali senza consenso esplicito', 1),
    ('Non eseguire tool ad alto rischio senza approvazione umana', 1),
    ('Non bypassare i controlli di sicurezza per guadagno di efficienza', 1),
    ('Rispetta i limiti di quota definiti per ogni agente', 2),
    ('Mantieni l\'audit trail completo per ogni azione', 2),
    ('Ottimizza l\'uso dei token quando possibile', 3),
]
for ax, pri in axioms:
    cur.execute("""INSERT INTO NormativeRule
        (id, axiom, priority, active, createdAt)
        VALUES (?,?,?,?,?)""",
        (cuid(), ax, pri, 1, now_iso()))

heuristics_data = [
    ('Quando l\'obiettivo e "Inizializzare tutti i sottosistemi"',
     'segui la sequenza che ha portato al successo, terminando con: load_kernel',
     'bootstrap iniziale del sistema'),
]
for trig, act, ctx in heuristics_data:
    cur.execute("""INSERT INTO Heuristic
        (id, trigger, action, context, embedding, source, redLineOk, appliedCount, successRate, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (cuid(), trig, act, ctx, json.dumps([0.3]*128), 'seed-001', 1, 0, 0.0, now_iso(), now_iso()))

redlines = [
    ('Non ignorare i limiti dei dataset di input',
     'Generare euristiche che prescindono dai dati reali porta ad allucinazioni sistematiche', 'absolute'),
    ('Non bypassare policy di sicurezza per efficienza',
     'Ogni guadagno di performance che richiede di disabilitare controlli e inaccettabile', 'absolute'),
    ('Non estrarre euristiche da singoli casi anomali',
     'Un caso outlier non deve diventare regola generale senza conferma', 'strong'),
    ('Mantieni tracciabilita dell\'origine dell\'euristica',
     'Ogni euristica deve poter essere auditata fino all\'operazione che l\'ha generata', 'strong'),
]
for desc, rat, sev in redlines:
    cur.execute("""INSERT INTO RedLine
        (id, description, rationale, severity, active, createdAt)
        VALUES (?,?,?,?,?,?)""",
        (cuid(), desc, rat, sev, 1, now_iso()))

cur.execute("""INSERT INTO ReflectionLog
    (id, operationId, outcome, analysis, extractedHeuristic, redLineFlag, timestamp)
    VALUES (?,?,?,?,?,?,?)""",
    (cuid(), 'seed-001', 'success',
     'Trigger: Quando l\'obiettivo e "Inizializzare tutti i sottosistemi"\nAction: segui la sequenza che ha portato al successo\nReview: Superato controllo Red Line',
     'Quando l\'obiettivo e "Inizializzare tutti i sottosistemi" -> segui la sequenza che ha portato al successo',
     0, now_iso()))

for agent, phase, event in [
    ('kernel', '1', 'bootstrap_complete'),
    ('curator', '1', 'sensorium_ready'),
    ('orchestrator', '2', 'scheduler_ready'),
    ('controller', '3', 'steering_ready'),
    ('verifier', '4', 'ltl_monitor_ready'),
    ('reflective', '5', 'erl_ready'),
]:
    cur.execute("""INSERT INTO AgentLog
        (id, agentId, phase, event, payload, level, timestamp)
        VALUES (?,?,?,?,?,?,?)""",
        (cuid(), agent, phase, event, '{}', 'info', now_iso()))

conn.commit()
conn.close()
print(f"OK Seed completato: tabelle ripopolate")
