/**
 * T2: Internationalization (i18n) — Translation registry IT/EN
 * 
 * Sistema lightweight senza dipendenze esterne.
 * Le chiavi sono organizzate per sezione per facilitare la manutenzione.
 */

export type Lang = 'it' | 'en'

export const translations: Record<Lang, Record<string, string>> = {
  it: {
    // Sidebar
    'sidebar.kernel_active': 'Kernel attivo',
    // Topbar
    'topbar.cycle': 'Ciclo',
    'topbar.load': 'Load',
    'topbar.queue': 'Queue',
    'topbar.threads': 'Threads',
    'topbar.logout': 'Logout',
    // Overview
    'overview.title': 'SOTA Agentic OS',
    'overview.description': 'Sistema Operativo Agentico · 18 micro-fasi',
    'overview.refresh': 'Aggiorna',
    'overview.seed': 'Inizializza Sistema',
    'overview.seeding': 'Inizializzazione…',
    'overview.empty_state': 'Sistema non inizializzato. Clicca Inizializza Sistema per caricare dati di esempio in tutte le 18 fasi.',
    'overview.architecture_map': 'Mappa Architetturale',
    'overview.architecture_desc': '14 fasi organizzate per categoria · clicca per navigare',
    'overview.quick_actions': 'Quick Actions',
    'overview.quick_actions_desc': 'Flussi comuni one-click',
    'overview.audit_log': 'Kernel Audit Log',
    'overview.total': 'totali',
    // Quick actions
    'qa.plan_task': 'Pianifica nuovo task',
    'qa.plan_desc': 'Genera piano JSON via LLM e DAG topologico',
    'qa.validate_trace': 'Verifica traccia esecuzione',
    'qa.validate_desc': 'Valida con dominator coverage score',
    'qa.request_approval': 'Richiedi approvazione umana',
    'qa.approval_desc': 'HITL gate per azioni irreversibili',
    'qa.route_prompt': 'Route prompt intelligente',
    'qa.route_desc': 'Ensemble fallback adattivo',
    // Categories
    'cat.foundation': 'Foundation',
    'cat.orchestration': 'Orchestration',
    'cat.cognitive': 'Cognitive',
    'cat.trust': 'Trust',
    'cat.learning': 'Learning',
    'cat.governance': 'Governance',
    'cat.infrastructure': 'Infrastructure',
    // Login
    'login.title': 'SOTA Agentic OS',
    'login.subtitle': 'Accedi alla plancia di comando',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.button': 'Accedi',
    'login.loading': 'Accesso…',
    'login.welcome': 'Benvenuto',
    // Common
    'common.refresh': 'Aggiorna',
    'common.save': 'Salva',
    'common.cancel': 'Annulla',
    'common.delete': 'Elimina',
    'common.install': 'Installa',
    'common.create': 'Crea',
    'common.execute': 'Esegui',
    'common.validate': 'Valida',
    'common.pending': 'In attesa',
    'common.no_data': 'Nessun dato disponibile',
    'common.related_phases': 'Fasi collegate',
    'common.related_desc': 'Naviga nel flusso end-to-end dell\'architettura',
  },
  en: {
    // Sidebar
    'sidebar.kernel_active': 'Kernel active',
    // Topbar
    'topbar.cycle': 'Cycle',
    'topbar.load': 'Load',
    'topbar.queue': 'Queue',
    'topbar.threads': 'Threads',
    'topbar.logout': 'Logout',
    // Overview
    'overview.title': 'SOTA Agentic OS',
    'overview.description': 'Agentic Operating System · 18 micro-phases',
    'overview.refresh': 'Refresh',
    'overview.seed': 'Initialize System',
    'overview.seeding': 'Initializing…',
    'overview.empty_state': 'System not initialized. Click Initialize System to load sample data across all 18 phases.',
    'overview.architecture_map': 'Architecture Map',
    'overview.architecture_desc': '14 phases organized by category · click to navigate',
    'overview.quick_actions': 'Quick Actions',
    'overview.quick_actions_desc': 'Common one-click flows',
    'overview.audit_log': 'Kernel Audit Log',
    'overview.total': 'total',
    // Quick actions
    'qa.plan_task': 'Plan new task',
    'qa.plan_desc': 'Generate JSON plan via LLM and topological DAG',
    'qa.validate_trace': 'Validate execution trace',
    'qa.validate_desc': 'Validate with dominator coverage score',
    'qa.request_approval': 'Request human approval',
    'qa.approval_desc': 'HITL gate for irreversible actions',
    'qa.route_prompt': 'Smart route prompt',
    'qa.route_desc': 'Adaptive ensemble fallback',
    // Categories
    'cat.foundation': 'Foundation',
    'cat.orchestration': 'Orchestration',
    'cat.cognitive': 'Cognitive',
    'cat.trust': 'Trust',
    'cat.learning': 'Learning',
    'cat.governance': 'Governance',
    'cat.infrastructure': 'Infrastructure',
    // Login
    'login.title': 'SOTA Agentic OS',
    'login.subtitle': 'Access the control panel',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.button': 'Login',
    'login.loading': 'Logging in…',
    'login.welcome': 'Welcome',
    // Common
    'common.refresh': 'Refresh',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.install': 'Install',
    'common.create': 'Create',
    'common.execute': 'Execute',
    'common.validate': 'Validate',
    'common.pending': 'Pending',
    'common.no_data': 'No data available',
    'common.related_phases': 'Related Phases',
    'common.related_desc': 'Navigate the end-to-end architecture flow',
  },
}

export function t(key: string, lang: Lang = 'it'): string {
  return translations[lang]?.[key] || translations.en?.[key] || key
}
