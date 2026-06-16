# 01 — Problem & Scope

Source: `TESA_PMO01_Proposal.pdf`, PMO-01 problem statement, mock dataset legend.

---

## 1. The problem

PMO analysts manually review every project plan before kickoff:

1. Check required sections against the PMO template.
2. Judge whether timeline, resource allocation, dependencies and risk are realistic.

This takes **3–5 hours per plan** across **6+ data sources**, is **inconsistent across
reviewers**, and **misses gaps** because each PM uses a different plan format. Historical
benchmarks are hard to retrieve manually, so feasibility issues surface late — often after
kickoff.

**Why it needs an agent (not a script):** the review reasons across **four interdependent
dimensions** — compliance, resource, timeline/dependency, historical velocity — that no
checklist can reconcile. Plans vary in format (semantic understanding, not keyword match),
benchmarking needs similarity judgement, and recommendations need generative reasoning.

## 2. The key insight (our differentiator)

> A plan can fully pass the compliance checklist yet still be infeasible.

In the mock data, the strongest predictor of failure is **not a missing section** but a
**hidden conflict between dimensions** — e.g. resource busy-rate looks acceptable (95%)
while the same team's historical velocity is only 62% of plan. Checklist-only tools miss
this entirely. ProjectPlanGuard's core value is **cross-dimension reconciliation**: surface
the conflict and explain *why* it makes the timeline unrealistic.

## 3. Scope

### In scope (POC)

- **Compliance check + gap report** — missing / weak / incomplete sections vs the PMO template (DS02/DS06).
- **Feasibility detection** — resource busy-rate per role, timeline realism, dependency-logic validation.
- **Historical benchmarking** — by effort, duration, velocity, risk (DS04/DS05), with outlier exclusion.
- **DS07 review report** — gaps, risk warnings, recommended adjustments.
- **Human-in-the-loop checkpoints** + audit trail.

### Out of scope (POC)

- Real-time Jira / ClickUp integration.
- Automated resource reallocation (we *recommend*, PMO *decides*).
- Multi-language document support.
- Final approval decision (stays with the PMO).
- Post-kickoff project monitoring.

## 4. Personas

| Persona | Pain |
|---|---|
| **PMO analyst / reviewer** | 3–5 h manual review per plan, inconsistent, misses cross-dimension conflicts |
| **Project Manager (submitter)** | Late feedback; rework after kickoff; unclear which sections are weak |
| **PMO lead / approver** | Needs evidence-grounded, standardised verdicts to approve/reject confidently |

## 5. Required capabilities → agent steps

From the proposal's agent flow (8 steps):

| # | Step | Tool(s) | Output / decision |
|---|---|---|---|
| 1 | PM submits DS01 + DS03 (plan + allocation) | — | Intent: plan review |
| 2 | Orchestrator loads context | `load_context()` | Beliefs updated |
| 3 | **Compliance check** (parallel) | `section_checker()`, `template_matcher()` | Gap report; custom sections flagged |
| 4 | **Feasibility check** (parallel) | `busy_rate_calc()`, `dependency_validator()` | Overload + dependency/timeline risks |
| 5 | **Benchmark & velocity** | `similarity_search()`, `velocity_comparator()` | Benchmark deviations, outliers excluded |
| 6 | **Synthesis & recommend** | `thi_scorer()`, `recommend_engine()` | DS07 draft + adjustments + reasoning |
| 7 | **Human review gate (PMO)** | — | Approve / revise / override |
| 8 | Deliver DS07 report | — | Report to PM |

## 6. Expected value (slide-7 metrics)

| Value area | Target |
|---|---|
| Faster review | 3–5 h → **10–15 min** per plan; frees ~20 PMO hours/week (5 plans × 4 h) |
| Consistent quality | Standardised thresholds + evidence-referenced DS07 every time |
| Earlier risk detection | Cross-dimension conflicts & infeasible timelines caught **before kickoff** |

## 7. Hard constraints (the agent's "Desires" — must-not-violate)

These come straight from the proposal's BDI desires and the Answer_Key. The agent must NOT:

1. **Auto-fail custom sections** — a custom section (e.g. `EVM_Cost_Tracking`) is *flagged for PMO review*, never counted as a compliance gap.
2. **Recommend resource changes without checking busy-rate** (DS03/DS08).
3. **Benchmark against outlier projects** (`Is_outlier = TRUE`, or implausibly tiny like PRJ-H-199 at 15 MD / 0.5 mo).
4. **Cite a conflict not present in the data** — every claim references a data source + row ID; unverifiable claims are flagged for PMO review, not asserted.
