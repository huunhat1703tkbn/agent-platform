# 04 — Agent Design

The multi-agent system, expressed in the platform's orchestrator-of-agents shape.
Pairs with [03-platform-mapping.md](03-platform-mapping.md) (where it lives) and
[05-feasibility-rules-and-ds07.md](05-feasibility-rules-and-ds07.md) (what it computes).

---

## 1. BDI model

| Layer | Definition | In ProjectPlanGuard |
|---|---|---|
| **Beliefs** | What the agent knows | Parsed plan (DS01), PMO rules (DS02/DS06), resource data (DS03/DS08), benchmarks (DS04/DS05), running scores in the shared context store (`RunCtx`) |
| **Desires** | Goal + hard constraints | Goal: produce an accurate DS07. Must NOT auto-fail custom sections, recommend resource changes without checking busy-rate, or benchmark against outliers (see [01 §7](01-problem-and-scope.md)) |
| **Intentions** | Committed plan of tool calls | Run Compliance + Feasibility in parallel → Benchmark → Synthesis; re-plan / pause on conflict or missing mandatory section |

## 2. The agents

```
                         ┌─────────────────────────┐
   "review PLAN-002" ───▶│      Orchestrator       │  owns routing + stop conditions
                         └────────────┬────────────┘
              ┌───────────────┬───────┴───────┬──────────────────┐
              ▼               ▼               ▼                  ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
     │ Compliance   │ │ Feasibility  │ │ Benchmark &  │ │ Synthesis &      │
     │ (hybrid)     │ │ (determin.)  │ │ Velocity     │ │ Recommendation   │
     │              │ │              │ │ (hybrid+RAG) │ │ (LLM, reasoning) │
     └──────────────┘ └──────────────┘ └──────────────┘ └────────┬─────────┘
       gap report       overload +        deviations,             │ DS07 draft
       custom flagged   dep/timeline      outliers excluded        ▼
                        risks                              ┌──────────────────┐
                                                           │ HITL approval    │
                                                           │ card → PMO        │
                                                           └──────────────────┘
```

| Agent | Mode | Tools it owns/calls | Produces |
|---|---|---|---|
| **Orchestrator** | LLM (fast tier) | sub-agent delegation tools + working memory | routing, conflict detection, stop conditions |
| **Compliance** | hybrid | `section_checker()`, `template_matcher()` | per-section status (Complete/Weak/Missing/Custom), weighted compliance score, custom-section flags |
| **Feasibility** | deterministic | `busy_rate_calc()`, `dependency_validator()`, `timeline_realism()` | role overload, capacity gap, dependency cycle, timeline risks — each with source+row refs |
| **Benchmark & Velocity** | hybrid + RAG | `similarity_search()`, `velocity_comparator()` | nearest historical projects (outliers excluded), velocity/SPI deviation |
| **Synthesis & Recommendation** | LLM (reasoning tier) | `thi_scorer()`, `recommend_engine()` | DS07 draft: THI%, feasibility_status, gaps, risk warnings, recommended adjustments, reasoning |

## 3. Agent flow (the 8 steps)

| # | Step | Memory | Tools | Output / decision |
|---|---|---|---|---|
| 1 | PM submits plan (pick PLAN-xxx or upload) | — | — | Intent: plan review |
| 2 | Orchestrator loads context | Working | `load_context()` | Beliefs updated (DS01/02/03/06/08 fetched) |
| 3 | Compliance check *(parallel with 4)* | Long-term / RAG | `section_checker()`, `template_matcher()` | Gap report; custom sections flagged (not failed) |
| 4 | Feasibility check *(parallel with 3)* | Working | `busy_rate_calc()`, `dependency_validator()` | Overload + dependency/timeline risks |
| 5 | Benchmark & velocity | Long-term / RAG | `similarity_search()`, `velocity_comparator()` | Benchmark deviations, outliers excluded |
| 6 | Synthesis & recommend | Working | `thi_scorer()`, `recommend_engine()` | DS07 draft + adjustments + reasoning |
| 7 | **Human review gate (PMO)** | — | — | Approve / revise / override |
| 8 | Deliver DS07 report | — | — | Report to PM (DS07 row written on approve) |

## 4. Memory model (maps to platform memory — [agent-architecture §10](../agent-architecture.md))

| Layer | Lifetime | Platform storage | Contents |
|---|---|---|---|
| Short-term | one turn | LLM context window | recent messages, current tool results |
| Working | per review run | `RunCtx` / thread working memory | shared context store: running scores, beliefs |
| Long-term / RAG | persistent | `pmo.history_embeddings` (pgvector) + `core.events` | historical benchmarks; audit of every tool call & finding |

## 5. Failure handling & re-planning policy

> Agent architecture = 35% of the score. Every failure mode has a deliberate response.

| Failure scenario | When it occurs | Agent response |
|---|---|---|
| **Tool failure / timeout** | any tool > 30 s or errors | Retry 2×; else mark step "Incomplete", other agents continue, **partial DS07 delivered** |
| **Ambiguous / out-of-scope** | missing mandatory section; unclear scope | Pause pipeline, open PMO checkpoint, draft a clarification note to the PM |
| **Hallucination risk** | agent cites a conflict not in DS03/DS08 | Every claim must reference a data source + row ID; unverifiable claims flagged for PMO review |
| **Cross-agent conflict** | resource OK but velocity low | Orchestrator forces **CAUTION**; Synthesis must reconcile before DS07 is issued |
| **Insufficient benchmark data** | too few similar historical projects | Flag "insufficient benchmark data" rather than guess; degrade gracefully |

Platform support that backs this: `defineAgentTool` auto-wraps read tools at 30 s / write tools
at 60 s with a 3-failure circuit breaker; workflow `replayFromStep`/`rerun`/`cancel` recover
stuck runs; HITL approval cards are the PMO checkpoint.

## 6. Autonomy boundary

- **Acts autonomously:** loading context, running all four analyses, computing scores, drafting the DS07 and recommendations.
- **Requires human input (HITL):** issuing/finalising the DS07 (the only write), and resolving ambiguity/conflict checkpoints. The **final approval decision always stays with the PMO** — the agent recommends, never auto-approves.

## 7. Why this is a genuine agent system (slide-5 talking points)

- **Reasoning** across four interdependent dimensions, not a checklist.
- **Planning** — parallel Compliance+Feasibility, then Benchmark, then Synthesis; re-plans on conflict.
- **Memory** — short-term thread, working shared-context scores, long-term pgvector benchmarks.
- **Dynamic tool selection** — orchestrator picks which sub-agents/tools per request.
- **Multi-agent coordination** — sub-agents hand structured findings to Synthesis, which reconciles conflicts.
- **Autonomy with HITL** — autonomous analysis, human-gated issuance.
