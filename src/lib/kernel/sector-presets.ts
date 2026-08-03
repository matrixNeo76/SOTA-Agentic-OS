/**
 * Sector Presets — Track 2.4
 *
 * 5 preset di settore che configurano automaticamente:
 * - Regole di compliance
 * - Regole LTL di sicurezza
 * - Tool predefiniti
 * - Euristiche seed
 * - Configurazione UI (label, workflow)
 *
 * Un'organizzazione sceglie un preset durante il signup.
 * Il preset può essere cambiato successivamente dall'admin.
 */
import { db } from '@/lib/db'

// === Preset definitions ===
export type PresetDefinition = {
  name: string
  displayName: string
  description: string
  complianceRules: string[]
  ltlRules: Array<{ ruleId: string; formula: string; severity: string; description: string }>
  defaultTools: Array<{ toolId: string; name: string; description: string }>
  heuristics: Array<{ trigger: string; action: string; context: string }>
  uiConfig: {
    primaryLabel?: string
    taskLabel?: string
    workflowSteps?: string[]
  }
}

export const PRESET_DEFINITIONS: PresetDefinition[] = [
  // === FINTECH ===
  {
    name: 'fintech',
    displayName: 'Fintech',
    description: 'Compliance-heavy, transazioni finanziarie, audit trail rigoroso',
    complianceRules: ['GDPR', 'SOC2', 'PCI-DSS', 'MiFID II'],
    ltlRules: [
      { ruleId: 'LTL-FIN-001', formula: 'G(transaction -> X audit_log)', severity: 'block', description: 'Ogni transazione deve essere seguita da un audit log' },
      { ruleId: 'LTL-FIN-002', formula: 'G(high_value -> human_approval)', severity: 'block', description: 'Transazioni ad alto valore richiedono approvazione umana' },
      { ruleId: 'LTL-FIN-003', formula: 'G(pii_access -> encrypted)', severity: 'block', description: 'Accesso a PII deve sempre essere cifrato' },
    ],
    defaultTools: [
      { toolId: 'payment-processor', name: 'Payment Processor', description: 'Elaborazione pagamenti con firma ECDSA' },
      { toolId: 'compliance-checker', name: 'Compliance Checker', description: 'Verifica compliance AML/KYC' },
    ],
    heuristics: [
      { trigger: 'Quando una transazione supera $10K', action: 'richiedi sempre approvazione umana', context: 'fintech' },
      { trigger: 'Quando un utente accede a dati PII', action: 'registra audit log con timestamp e IP', context: 'fintech' },
    ],
    uiConfig: {
      primaryLabel: 'Transazione',
      taskLabel: 'Operazione',
      workflowSteps: ['KYC', 'AML Check', 'Esecuzione', 'Audit'],
    },
  },

  // === HEALTHCARE ===
  {
    name: 'healthcare',
    displayName: 'Healthcare',
    description: 'HIPAA compliance, patient data isolation, clinical workflows',
    complianceRules: ['HIPAA', 'GDPR', 'SOC2'],
    ltlRules: [
      { ruleId: 'LTL-HC-001', formula: 'G(patient_data -> encrypted)', severity: 'block', description: 'Dati paziente devono sempre essere cifrati' },
      { ruleId: 'LTL-HC-002', formula: 'G(diagnosis -> X doctor_review)', severity: 'block', description: 'Ogni diagnosi deve essere seguita da revisione medica' },
      { ruleId: 'LTL-HC-003', formula: 'G(emergency -> immediate_response)', severity: 'block', description: 'Emergenze richiedono risposta immediata' },
    ],
    defaultTools: [
      { toolId: 'ehr-connector', name: 'EHR Connector', description: 'Connettore Electronic Health Records' },
      { toolId: 'clinical-decision', name: 'Clinical Decision Support', description: 'Supporto decisionale clinico' },
    ],
    heuristics: [
      { trigger: 'Quando si accede a dati paziente', action: 'verifica sempre che l\'utente abbia autorizzazione HIPAA', context: 'healthcare' },
      { trigger: 'Quando una diagnosi viene generata', action: 'notifica sempre il medico responsabile', context: 'healthcare' },
    ],
    uiConfig: {
      primaryLabel: 'Caso',
      taskLabel: 'Procedura',
      workflowSteps: ['Triage', 'Diagnosi', 'Piano', 'Esecuzione', 'Follow-up'],
    },
  },

  // === DEV TOOLS ===
  {
    name: 'dev-tools',
    displayName: 'Dev Tools',
    description: 'CI/CD integration, code review automation, security scanning',
    complianceRules: ['SOC2'],
    ltlRules: [
      { ruleId: 'LTL-DEV-001', formula: 'G(deploy -> X test_verification)', severity: 'block', description: 'Ogni deploy deve essere seguito da verifica test' },
      { ruleId: 'LTL-DEV-002', formula: 'G(code_change -> review)', severity: 'warn', description: 'Ogni modifica al codice richiede review' },
    ],
    defaultTools: [
      { toolId: 'github-integration', name: 'GitHub Integration', description: 'PR review, issue tracking, CI/CD' },
      { toolId: 'security-scanner', name: 'Security Scanner', description: 'Scansione vulnerability automatizzata' },
      { toolId: 'filesystem-browser', name: 'Filesystem Browser', description: 'Browse e edit file di progetto' },
    ],
    heuristics: [
      { trigger: 'Quando si fa un deploy in produzione', action: 'esegui sempre test di regressione completi', context: 'dev-tools' },
      { trigger: 'Quando si modifica codice critico', action: 'richiedi sempre review di un secondo sviluppatore', context: 'dev-tools' },
    ],
    uiConfig: {
      primaryLabel: 'Task',
      taskLabel: 'Build',
      workflowSteps: ['Code', 'Review', 'Test', 'Deploy'],
    },
  },

  // === RESEARCH ===
  {
    name: 'research',
    displayName: 'Research',
    description: 'Experiment tracking, hypothesis testing, paper generation',
    complianceRules: ['GDPR'],
    ltlRules: [
      { ruleId: 'LTL-RES-001', formula: 'G(experiment -> X validation)', severity: 'warn', description: 'Ogni esperimento deve essere validato' },
    ],
    defaultTools: [
      { toolId: 'data-analyzer', name: 'Data Analyzer', description: 'Analisi statistica e visualizzazione' },
      { toolId: 'paper-generator', name: 'Paper Generator', description: 'Generazione bozze paper scientifici' },
    ],
    heuristics: [
      { trigger: 'Quando un esperimento produce risultati', action: 'confronta sempre con baseline stabilita', context: 'research' },
    ],
    uiConfig: {
      primaryLabel: 'Esperimento',
      taskLabel: 'Analisi',
      workflowSteps: ['Ipotesi', 'Setup', 'Esecuzione', 'Analisi', 'Conclusioni'],
    },
  },

  // === GENERIC ===
  {
    name: 'generic',
    displayName: 'Generico',
    description: 'Preset default per qualsiasi organizzazione',
    complianceRules: ['GDPR'],
    ltlRules: [
      { ruleId: 'LTL-GEN-001', formula: 'G(irreversible -> human_approval)', severity: 'block', description: 'Azioni irreversibili richiedono approvazione umana' },
    ],
    defaultTools: [
      { toolId: 'web-search', name: 'Web Search', description: 'Ricerca web generale' },
    ],
    heuristics: [
      { trigger: 'Quando un task fallisce 3 volte consecutive', action: 'fermati e chiedi supporto umano', context: 'generic' },
    ],
    uiConfig: {
      primaryLabel: 'Task',
      taskLabel: 'Operazione',
      workflowSteps: ['Pianificazione', 'Esecuzione', 'Verifica', 'Riflessione'],
    },
  },
]

// === Initialize presets in DB ===
export async function initializePresets(): Promise<void> {
  for (const preset of PRESET_DEFINITIONS) {
    const existing = await db.sectorPreset.findUnique({ where: { name: preset.name } })
    if (!existing) {
      await db.sectorPreset.create({
        data: {
          name: preset.name,
          displayName: preset.displayName,
          description: preset.description,
          complianceRules: JSON.stringify(preset.complianceRules),
          ltlRules: JSON.stringify(preset.ltlRules),
          defaultTools: JSON.stringify(preset.defaultTools),
          heuristics: JSON.stringify(preset.heuristics),
          uiConfig: JSON.stringify(preset.uiConfig),
        },
      })
      console.log(`[presets] Created preset: ${preset.name}`)
    }
  }
}

// === Apply preset to organization ===
export async function applyPreset(organizationId: string, presetName: string): Promise<void> {
  const preset = PRESET_DEFINITIONS.find(p => p.name === presetName)
  if (!preset) throw new Error(`Preset '${presetName}' not found`)

  // Update org compliance preset
  await db.organization.update({
    where: { id: organizationId },
    data: { compliancePreset: presetName },
  })

  // Seed LTL rules for this org
  for (const rule of preset.ltlRules) {
    try {
      await db.lTLRule.upsert({
        where: { ruleId: rule.ruleId },
        create: {
          ruleId: rule.ruleId,
          formula: rule.formula,
          severity: rule.severity,
          description: rule.description,
          active: true,
          organizationId,
        },
        update: { active: true },
      })
    } catch {}
  }

  // Seed heuristics for this org
  for (const h of preset.heuristics) {
    try {
      await db.heuristic.create({
        data: {
          trigger: h.trigger,
          action: h.action,
          context: h.context,
          successRate: 0,
          usageCount: 0,
          redLineFlagged: false,
          organizationId,
        },
      })
    } catch {}
  }

  console.log(`[presets] Applied preset '${presetName}' to org ${organizationId}`)
}

// === Get preset by name ===
export async function getPreset(name: string): Promise<PresetDefinition | null> {
  const preset = PRESET_DEFINITIONS.find(p => p.name === name)
  return preset || null
}

// === List all presets ===
export async function listPresets(): Promise<Array<{ name: string; displayName: string; description: string }>> {
  return PRESET_DEFINITIONS.map(p => ({
    name: p.name,
    displayName: p.displayName,
    description: p.description,
  }))
}
