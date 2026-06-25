# SOTA Agentic OS — Diagramma Architetturale

> Diagrammi Mermaid dell'architettura del sistema.

---

## 1. Architettura di Sistema (Overview)

```mermaid
graph TB
    subgraph "Browser (User)"
        UI[Workbench UI<br/>Console · Cockpit · Canvas<br/>Timeline · Sovereign]
    end

    subgraph "Next.js App"
        MW[Middleware<br/>Auth Gate]
        API[37 API Routes<br/>SSE Streaming]
        SSR[SSR Pages<br/>login · share · 404]
    end

    subgraph "Kernel (25 moduli)"
        F1[F1 Memory & State<br/>ns-mem · patchboard]
        F2[F2 Planner<br/>scheduler · compiled-ai]
        F3[F3 Steering<br/>acts]
        F4[F4 Verify & Taint<br/>ltl-monitor · taint · normative]
        F5[F5 Reflective<br/>erl]
        F6[F6 Context<br/>context-engineering]
        F7[F7 Trace<br/>dominator-tree]
        F8[F8 Lean4<br/>lean4-agent]
        F9[F9 Retainer<br/>artificial-retainer]
        F10[F10 Encapsulator<br/>grounded-inference]
        F11[F11 Affect<br/>affect-subsystem]
        F12[F12 Objective<br/>agent-objective]
        F13[F13 Swarm<br/>esr-quorum]
        F14[F14 Router<br/>time-router]
        MCP[MCP<br/>mcp-client · skill-manager]
        COST[Cost<br/>cost-ledger]
        CRYPTO[Crypto Trust<br/>crypto-trust ECDSA]
    end

    subgraph "Infrastructure"
        DB[(SQLite/PostgreSQL<br/>62 models)]
        REDIS[(Redis<br/>pub/sub)]
        LLM[ZAI SDK<br/>zai-glm]
        EMB[Xenova Transformers<br/>all-MiniLM-L6-v2]
        WS[Socket.IO<br/>Sensorium]
    end

    UI -->|HTTPS + WebSocket| MW
    MW -->|auth check| API
    API --> F1 & F2 & F3 & F4 & F5 & F6 & F7 & F8 & F9 & F10 & F11 & F12 & F13 & F14
    API --> MCP & COST & CRYPTO
    F1 --> DB
    F2 --> LLM
    F5 --> LLM
    F10 --> LLM
    F1 --> EMB
    API --> REDIS
    API --> WS
    UI --> WS
```

---

## 2. Flusso di Esecuzione End-to-End

```mermaid
sequenceDiagram
    participant U as User
    participant C as Console UI
    participant API as /api/console/stream
    participant S as Scheduler (F2)
    participant A as ACTS (F3)
    participant L as LTL Monitor (F4)
    participant LLM as ZAI SDK
    participant E as ERL (F5)
    participant DB as Database

    U->>C: Scrive task
    C->>API: POST /api/console/stream (SSE)
    API->>S: validatePlan(goal)
    S->>S: topologicalBatches(tasks)
    S-->>C: SSE: plan_start

    loop Per ogni batch
        S->>A: steer(task, context)
        A-->>API: strategia (EXECUTE)
        API->>L: verifyEvent(state, event)
        L-->>API: verdict (accept/warn/reject)

        alt reject
            API->>DB: BlockedAction.create()
            API-->>C: SSE: action_blocked
            C->>U: Sovereign Modal (HITL)
            U->>C: Approva/Modifica/Rifiuta
        else accept
            API->>LLM: chat.completions.create(prompt)
            LLM-->>API: response
            API-->>C: SSE: task_complete
        end

        API->>E: reflectAndLearn(result)
        E->>DB: Heuristic.create()
        E-->>C: SSE: reflection_complete
    end

    API-->>C: SSE: done (summary)
    C->>U: ResultCard (expandibile)
```

---

## 3. Componenti UI (Struttura)

```mermaid
graph LR
    subgraph "App Shell"
        PAGE[page.tsx]
        SIDEBAR[Sidebar<br/>3 sezioni · 9 voci]
        TOPBAR[Topbar<br/>Breadcrumb · StatusBar · Cmd+K]
        WV[WorkspaceViews<br/>6 tab views]
        CP[Context Panel<br/>4 modalità]
    end

    subgraph "Views"
        CONSOLE[Console<br/>AgentConsole]
        CANVAS[Canvas<br/>3 DAG types]
        TIMELINE[Timeline<br/>Event log]
        COCKPIT[Cockpit<br/>5 tab + 2 widget]
        SOVEREIGN[Sovereign<br/>Blocked actions]
        PHASE[Phase View<br/>4 domains]
    end

    subgraph "Console Decomposition"
        AC[agent-console.tsx<br/>orchestrator]
        ML[message-list.tsx]
        MB[message-bubble.tsx<br/>ResultCard · StepRow]
        CI[console-input.tsx<br/>Skill picker]
        CW[console-welcome.tsx<br/>3 capability cards]
        UCS[use-console-stream.ts<br/>SSE hook]
    end

    subgraph "Cockpit Decomposition"
        CC[cockpit-container.tsx]
        W[widgets.tsx<br/>Sensorium · AffectGauge]
        T[tabs.tsx<br/>5 tab components]
    end

    subgraph "Domains"
        DM[Memory & Context<br/>Phase1 · Phase6 · Phase10]
        DP[Plan & Execute<br/>Phase2 · Phase3 · Phase12]
        DV[Verify & Trust<br/>Phase4 · Phase7 · Phase8 · Phase13]
        DL[Learn & Route<br/>Phase5 · Phase11 · Phase14 · Phase9]
    end

    PAGE --> SIDEBAR & TOPBAR & WV & CP
    WV --> CONSOLE & CANVAS & TIMELINE & COCKPIT & SOVEREIGN & PHASE
    CONSOLE --> AC
    AC --> ML & CI
    ML --> MB & CW
    AC --> UCS
    COCKPIT --> CC
    CC --> W & T
    PHASE --> DM & DP & DV & DL
```

---

## 4. State Management (Zustand)

```mermaid
graph TB
    subgraph "Navigation Store (store.ts)"
        AP[activePhase<br/>Phase type]
        AV[activeView<br/>WorkspaceView]
        CPM[contextPanelMode<br/>quickstats/phase/inspector/help]
        SI[selectedItem<br/>node/log/blocked]
        CP[commandPaletteOpen]
    end

    subgraph "Data Store (data-store.ts)"
        DASH[dashboard<br/>TTL: 5s]
        BLOCK[blockedPending<br/>TTL: 10s]
        COST[cost<br/>TTL: 30s]
        AFF[affect<br/>TTL: 5s]
        LOGS[logs<br/>TTL: 10s]
        SGR[startGlobalRefresh<br/>singleton interval]
    end

    subgraph "Transfer Store (transfer-store.ts)"
        PTS[pendingTabSwitch]
        PS[pendingStepping]
        SV[shortcutsVisible]
    end

    subgraph "Consumers"
        SIDEBAR[Sidebar<br/>uses activePhase]
        TOPBAR[Topbar<br/>uses activePhase]
        STATUSBAR[StatusBar<br/>uses cost]
        OVERVIEW[Overview<br/>uses dashboard]
        SOVEREIGN[Sovereign Modal<br/>uses blockedPending]
        COCKPIT[Cockpit<br/>uses affect + logs]
    end

    AP --> SIDEBAR & TOPBAR
    COST --> STATUSBAR
    DASH --> OVERVIEW
    BLOCK --> SOVEREIGN
    AFF --> COCKPIT
    LOGS --> COCKPIT
    SGR --> DASH & BLOCK & COST & AFF & LOGS
```

---

## 5. Design System (Token Flow)

```mermaid
graph TB
    subgraph "CSS Variables (globals.css)"
        SB[--surface-base]
        SE[--surface-elevated]
        SO[--surface-overlay]
        BR[--brand oklch 0.52 0.19 245]
        CF[--cat-foundation]
        CO2[--cat-orchestration]
        CC2[--cat-cognitive]
        CT[--cat-trust]
        CL[--cat-learning]
        CG[--cat-governance]
        CI2[--cat-infrastructure]
        SO2[--status-ok]
        SW[--status-warn]
        SD[--status-danger]
        SI3[--status-info]
    end

    subgraph "Tailwind @theme inline"
        CB[color-background → surface-base]
        CC3[color-card → surface-elevated]
        CP[color-primary → brand]
        CSO[color-status-ok]
        CSW[color-status-warn]
        CSD[color-status-danger]
        CCF[color-cat-foundation]
    end

    subgraph "Tailwind Classes (native)"
        BGB[bg-background]
        BGC[bg-card]
        BGP[bg-primary]
        BGS[bg-status-ok/10]
        BGSW[bg-status-warn/10]
        TC[text-status-danger]
        TCF[text-cat-foundation]
    end

    subgraph "design-tokens.ts"
        DT[CATEGORY_COLORS<br/>STATUS_TONES<br/>SHADOW_CLASSES<br/>helpers]
    end

    SB --> CB --> BGB
    SE --> CC3 --> BGC
    BR --> CP --> BGP
    SO2 --> CSO --> BGS
    SW --> CSW --> BGSW
    SD --> CSD --> TC
    CF --> CCF --> TCF
    DT -.-> BGC & BGP & BGS & TC
```

---

## 6. Sicurezza e Auth Flow

```mermaid
sequenceDiagram
    participant U as User
    participant MW as Middleware
    participant API as /api/auth
    participant DB as Database
    participant APP as App Page

    U->>MW: GET / (no cookie)
    MW->>MW: isPublic("/")? NO
    MW->>U: 307 Redirect /login?next=/

    U->>MW: GET /login
    MW->>MW: isPublic("/login")? YES
    MW->>APP: Render login page

    U->>API: POST /api/auth {action: login, email, password}
    API->>DB: authenticateUser(email, password)
    DB-->>API: user data
    API->>DB: createSession(userId)
    DB-->>API: session token
    API->>U: 200 + Set-Cookie: sota_session (httpOnly, 7d)

    U->>MW: GET / (with cookie)
    MW->>MW: isPublic("/")? NO
    MW->>MW: cookie sota_session exists? YES
    MW->>APP: Render app

    Note over MW: Middleware verifica solo<br/>esistenza cookie.<br/>API routes verificano<br/>il token internamente.
```

---

## 7. MCP Protocol Flow

```mermaid
sequenceDiagram
    participant EXT as External Client<br/>(Claude Desktop, Cursor)
    participant MCP as /api/mcp<br/>(JSON-RPC 2.0)
    participant DB as Database
    participant TOOLS as Tool Registry
    participant SKILLS as Skill Manager

    EXT->>MCP: initialize (handshake)
    MCP-->>EXT: protocolVersion + capabilities

    EXT->>MCP: tools/list
    MCP->>DB: query active tools
    MCP->>DB: query external MCP tools
    MCP-->>EXT: [sota_health, sota_plan, sota_verify, ext_*]

    EXT->>MCP: tools/call {name: "sota_plan", args: {goal: "..."}}
    MCP->>MCP: builtin? YES
    MCP->>TOOLS: execute plan generation
    TOOLS-->>MCP: plan result
    MCP-->>EXT: {content: [{type: text, text: JSON}]}

    EXT->>MCP: prompts/list
    MCP->>SKILLS: query skills
    MCP-->>EXT: [task-analyzer, code-reviewer, ...]

    EXT->>MCP: resources/read {uri: "sota://plans/abc123"}
    MCP->>DB: query plan
    MCP-->>EXT: {contents: [{uri, text: JSON}]}
```

---

## 8. Kernel Module Dependencies

```mermaid
graph TD
    F2[F2 Scheduler] --> F1[F1 Memory]
    F2 --> F3[F3 ACTS]
    F3 --> F4[F4 LTL + Taint]
    F3 --> F10[F10 Encapsulator]
    F4 --> F9[F9 Retainer]
    F10 --> F5[F5 ERL]
    F5 --> F1
    F2 --> F12[F12 Objective]
    F2 --> F6[F6 Context]
    F3 --> F11[F11 Affect]
    F3 --> F14[F14 Router]
    F4 --> F7[F7 Trace]
    F4 --> F8[F8 Lean4]
    F4 --> F13[F13 Swarm]
    F9 --> CRYPTO[Crypto Trust]
    F2 --> COST[Cost Ledger]
    F1 --> EMB[Embeddings]
```
