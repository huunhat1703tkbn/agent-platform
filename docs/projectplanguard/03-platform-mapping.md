# 03 — Platform Mapping (ProjectPlanGuard on Seta)

How the proposal's design lands on the Seta modular monolith. Read alongside
[`docs/architecture.md`](../architecture.md), [`docs/agent-architecture.md`](../agent-architecture.md),
and [`docs/creating-modules.md`](../creating-modules.md).

---

## Decision D1 — stack reconciliation (READ FIRST)

The proposal names **FastAPI + LangGraph + Next.js + GPT-4**. The assignment is to build on the
**Seta boilerplate**, whose foundations are *fixed and not up for substitution* (CLAUDE.md):

| Proposal said | Seta platform provides | We use |
|---|---|---|
| LangGraph state machine | **Mastra** agents + workflows (agent-of-agents) | Mastra |
| FastAPI backend | **Hono** HTTP, module sub-apps | Hono |
| Next.js UI | **React 19 + TanStack Router + shadcn/ui + assistant-ui** | platform web shell |
| pgvector RAG | **pgvector + `@seta/shared-embeddings`/`-retrieval`** | platform RAG |
| Postgres | **Postgres 17 + Drizzle (`pgSchema`)** | platform DB |
| GPT-4-class | `AGENT_MODELS` (default `openai/gpt-5.5`) | platform model registry |

**The conceptual design (orchestrator + 4 specialised agents + HITL + benchmark RAG) maps
1:1 onto Seta's `staffing` orchestrator pattern.** We keep the *design* and swap the
*plumbing* to the platform's. This is strictly better for judging: the orchestrator,
HITL approval cards, audit via the event outbox, and pgvector retrieval already exist and
are production-grade.

---

## Module topology

Two new packages, following the `planner` (feature) + `staffing` (orchestrator) precedent:

```
packages/
├── pmo/            # FEATURE module — owns the data, the deterministic tools, the RAG index
│   └── (pmo schema: ds01_tasks, ds02_template, ds03_alloc, ds04_velocity,
│        ds05_history, ds06_section_check, ds07_report, ds08_capacity,
│        ref_member, ref_project, kpi_norms, history_embeddings)
└── pmo-review/     # ORCHESTRATOR module — composes the 4 sub-agents + synthesis (schemaless;
                    #   run state in agent.workflow_runs, like staffing)
```

> **Hackathon simplification (optional):** if time is tight, fold the orchestration sub-agents
> into the `pmo` module's `agent-specs.ts` instead of a separate `pmo-review` package. The
> separate orchestrator is cleaner and matches `staffing`; the folded version is faster to ship.
> Recommended: start folded, split only if it pays off.

### Generating the module

```bash
pnpm gen module           # name: pmo · tier: feature · web companion: Y
# then edit packages/pmo/src/backend/db/schema.ts (the DS tables)
pnpm --filter @seta/pmo db:generate && pnpm db:migrate
```

See [`docs/creating-modules.md`](../creating-modules.md) for the full walkthrough.

---

## Mapping: proposal concept → Seta primitive

| Proposal concept | Seta primitive | Where it lives |
|---|---|---|
| Orchestrator | Mastra agent-of-agents (`runInline`), bound at composition root | `pmo-review` orchestration runtime; wired in `apps/server` |
| Compliance / Feasibility / Benchmark / Synthesis agents | Sub-agents invoked as **orchestrator tools** (LLM or deterministic) | `pmo-review/src/backend/orchestration/agents/` |
| `section_checker`, `busy_rate_calc`, `dependency_validator`, `velocity_comparator`, `thi_scorer` | **deterministic** functions exposed as agent tools / cross-module reads | `pmo/src/backend/agent-tools/` + `domain/` |
| `similarity_search` (benchmarks) | `@seta/shared-retrieval` `Retriever` over `pmo.history_embeddings` | `pmo/src/backend/domain/find-similar-projects.ts` |
| `recommend_engine` | LLM reasoning in the Synthesis sub-agent (generative) | `pmo-review` Synthesis agent |
| Shared context store (working memory) | `RunCtx` + thread-scoped working memory | orchestration kernel (`shared-orchestration`) |
| Long-term / RAG memory | pgvector HNSW in `pmo` schema | `pmo.history_embeddings` |
| Human review gate (step 7) | **HITL approval card** (`workflow_approvals`) | orchestrator post-step + `/workflows/approvals/:id/decide` |
| Audit trail | transactional outbox `core.events` + `agent.workflow_runs` | automatic |
| DS07 report | a `pmo` domain write (`saveReviewReport`) gated by HITL | `pmo/src/backend/domain/save-review-report.ts` |

---

## Why each agent maps to deterministic vs LLM (the staffing lesson)

Staffing makes `avaiChecker` and `recommender` **deterministic** (pure functions over fetched
data) to remove LLM hops, latency, and hallucination. We apply the same split:

| Sub-agent | LLM or deterministic | Reason |
|---|---|---|
| **Compliance** | hybrid — deterministic status roll-up from DS06 + LLM for semantic section matching on free-form plans | weights/thresholds are pure; "is this section semantically present?" needs the LLM |
| **Feasibility** | **deterministic** — busy-rate, capacity gap, dependency cycle, timeline are formulas/graph algorithms | fully computable from DS01/DS03/DS08; must be auditable & exact vs Answer_Key |
| **Benchmark & Velocity** | hybrid — deterministic velocity/SPI math + vector similarity search + LLM judgement on "what is similar" and outlier exclusion | similarity needs embeddings + judgement; comparison is math |
| **Synthesis & Recommendation** | **LLM (reasoning tier)** — reconcile cross-dimension conflicts, explain *why*, draft adjustments | generative reasoning is the whole point |

This keeps the numbers exact (and gradeable) while letting the LLM do what only an LLM can.

---

## Boundary & rule compliance (must-haves for CI to pass)

- **No cross-schema FKs** — `pmo.ds01_tasks.assignee_id` is a `uuid`/string with no FK; resolve via REF tables in-app.
- **Public surface only** — `pmo-review` imports `pmo` through `@seta/pmo` (its `index.ts`/`/agent-tools`), never `src/backend/**`.
- **HITL on every write** — the DS07 save tool sets `needsApproval: true` (or `ctx.agent.suspend`).
- **Source-referenced claims** — every finding carries `{ source: 'DS03', row_id: '…' }` so the audit trail (and the no-hallucination rule) holds.
- **`agent` engine stays clean** — orchestration lives in `pmo-review`, bound at `apps/server`; `packages/agent` never imports it.
- **Styles only in `@seta/shared-ui`**, raw SQL never crosses schemas, Drizzle `schemaFilter: ['pmo']`.

## End-to-end request shape

```
PM uploads plan / picks PLAN-002
   └─▶ POST /api/agent/v1/chat  ("review PLAN-002")
        └─▶ pmo-review orchestrator (runInline)
             ├─ load_context (pmo reads: DS01, DS02, DS03, DS06, DS08)         [Beliefs]
             ├─ Compliance  ┐ parallel
             ├─ Feasibility ┘ (deterministic scoring + cycle detection)
             ├─ Benchmark & Velocity (similarity_search over pmo.history_embeddings)
             ├─ Synthesis & Recommendation (LLM reasoning tier → DS07 draft)
             └─ post-step: record HITL approval card (DS07 preview)
   ◀── DS07 draft + pending approval card
PMO approves/revises ─▶ POST /workflows/approvals/:id/decide
   └─▶ pmo.saveReviewReport (writes DS07 row + emits pmo.report.issued event) → audit
```
