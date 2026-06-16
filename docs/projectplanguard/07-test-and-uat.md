# 07 — Test Cases & UAT Plan

Two layers: (1) **correctness tests** against the Answer_Key oracle (for our own CI + slide-7
accuracy), and (2) the **UAT scenario plan** the Advisory Board runs (per `SETA_Hackathon_2026_UAT_Guide.docx`).

---

## 1. Correctness oracle — the Answer_Key

> ⚠️ The `Answer_Key` sheet is the grading key. Use it for tests; **remove/ignore it from any
> blind run** so the agent derives findings from DS01–DS08, not the answers.

| Finding | Entity | Issue type | Expected detection | Severity | Tested by |
|---|---|---|---|---|---|
| **F-01** | PLAN-002 | Missing_section | Risk Register (S07) missing → Risk pillar defaults to Red | High | `scoreCompliance` + roll-up |
| **F-02** | PLAN-002 | Weak_section | Resource_Plan & Acceptance_Criteria are thin | Medium | `scoreCompliance` |
| **F-03** | PLAN-002 | Feasibility | Peak role busy ~135% + THI 9% (<10%) | High | `computeBusyRate` + `computeThi` |
| **F-04** | PLAN-002 | Custom_section | EVM_Cost_Tracking is custom → flag for review, NOT a gap | Info | custom-exclusion rule |
| **F-05** | PLAN-001 | Baseline_OK | All 8 sections present; velocity 24 ≈ Migration benchmark ~22.5 → feasible | Info | full pipeline (green path) |
| **F-06** | PRJ-H-199 | Benchmark_outlier | Exclude from benchmark (15 MD / 0.5 mo, too small) | Info | `findSimilarProjects` outlier filter |
| **F-1C** | PLAN-002 | Dependency_cycle | Cycle TASK-E07↔TASK-E08 + test-before-build (E06) | High | `validateDependencies` |

**Accuracy metric for slide 7:** `findings detected / 7` per plan, plus false-positive count
(e.g. must NOT flag PLAN-001 sections, must NOT count EVM_Cost_Tracking as a gap).

### Test layers (platform convention — real Postgres via testcontainers, no DB mocks)

| Layer | Location | Asserts |
|---|---|---|
| Unit | `packages/pmo/tests/unit/` | each formula in [05](05-feasibility-rules-and-ds07.md) in isolation |
| Integration | `packages/pmo/tests/integration/` | seed → run pipeline on PLAN-001/002 → assert findings == Answer_Key + emitted `pmo.report.issued` event row |
| Contract | `packages/pmo/tests/contract/` | only `@seta/pmo` imports resolve the public surface |
| E2E | root `tests/e2e/` | upload/pick plan → DS07 dashboard → PMO approves |

---

## 2. UAT scenario plan (Advisory Board)

Multi-agent system ⇒ **5–8 scenarios**, covering categories A/B/C. Each maps to a slide-7 metric.

### Category A — Core functionality (≥2)

| # | Scenario | Input | Expected output |
|---|---|---|---|
| A1 | **Simple review (green path)** | "Review PLAN-001" | DS07: Feasible (Green), all 8 sections present, velocity matches benchmark, no gaps |
| A2 | **Complex multi-agent review (hero case)** | "Review PLAN-002 and tell me if it's ready for kickoff" | DS07: Not feasible (Red) — missing Risk Register, peak busy ~135%, THI 9%, dependency cycle; with recommended adjustments; agents visibly hand off to Synthesis; PMO approval card appears |

### Category B — Agent intelligence (≥2)

| # | Scenario | What it tests | Input | Observe |
|---|---|---|---|---|
| B1 | **Memory / context** | context retention | After A2: "Why is the timeline unrealistic?" | Uses prior run's findings without re-asking; explains the busy-rate ↔ velocity conflict |
| B2 | **Autonomy vs clarification** | autonomy level | "Review the data platform plan" (ambiguous which plan) | Either picks PLAN-002 and explains why, or asks to disambiguate |
| B3 | **Tool selection / planning** | dynamic tools, decomposition | "Compare PLAN-002 to similar past projects" | Routes to Benchmark agent; similarity_search; excludes outliers; reaches same answer asked two ways |

### Category C — Error & edge cases (≥1)

| # | Scenario | Input | Observe |
|---|---|---|---|
| C1 | **Beyond-scope / hallucination control** | "Should we use Jira or ClickUp?" (out of scope) | Explains limits, does not fabricate; no claim without a DS source+row |
| C2 | **Ambiguous / missing data** | Review a plan with a missing mandatory section | Pauses, opens PMO checkpoint, drafts clarification note rather than auto-failing |
| C3 | **Partial failure** | Force a tool timeout | Marks that step Incomplete, other agents continue, partial DS07 delivered with a clear note |

### Mapping to evaluation criteria (slide 7)

| Scenario | Slide-7 metric | Pass = |
|---|---|---|
| A1 / A2 | Output quality | DS07 matches Answer_Key, no false positives |
| B3 | Reasoning quality | clear decomposition shown |
| B1 | Context retention | uses earlier findings |
| B2 | Autonomy level | smart pick or sensible clarification |
| B3 | Processing speed | right tool → faster path |
| A2 | Agent coordination | sub-agents → Synthesis, unified DS07 |
| A2 | Efficiency improvement | combined output beats per-agent |
| C1–C3 | Edge-case handling | graceful, clear communication |

---

## 3. Known limitations (be honest — UAT §4)

- English dataset only (no multi-language plan parsing — out of scope).
- Benchmark quality bounded by the mock history (~12 projects); "insufficient benchmark data" surfaced when too few similar non-outliers.
- No live Jira/ClickUp; reviews the supplied DS01-DS08 only.
- Recommends, does not auto-apply; final approval stays with the PMO.
- Multi-agent response time ~30–90 s (agents coordinate); thinking time is normal, not a bug.
