# 05 — Feasibility Rules & DS07 Output Schema (the computational core)

This is the **algorithmic heart**. These rules must produce the Answer_Key findings
([07-test-and-uat.md](07-test-and-uat.md)) and match the DS07 example values. Keep the
deterministic parts in pure functions so they're exact and gradeable.

All RAG thresholds come from `REF_KPI_Norms` (SETA-08-SOP-001). RAG = **R**ed/**A**mber(Yellow)/**G**reen.

---

## 1. KPI thresholds (Problem-1 relevant)

| Norm | Metric | Formula | 🟢 Green | 🟡 Yellow | 🔴 Red |
|---|---|---|---|---|---|
| N01 | **Busy Rate** | Planned_h / Available_h | 85–110% | 111–119% | **>120% or <75%** |
| N06 | Effort Consumption | Actual_h / Planned_h | 85–110% | 75–84% / 111–119% | ≤75% or ≥120% |
| N07 | **On-time Delivery** | On-time_MS / Total_MS | ≥90% | 70–89% | <70% |
| N08 | **SPI** | EV / PV | 0.95–1.05 | 0.85–0.94 / 1.06–1.15 | <0.85 or >1.15 |
| N09 | Velocity Variance | StdDev(5 sprints) / Avg | ≤15% | 16–25% | >25% |
| N10 | **THI** (tech-health) | Non-dev_h / Total_h | 15–25% | 10–14% / 26–35% | **<10% or >35%** |
| N11 | Risk Closure Rate | Risks_closed / Total | ≥80% | 60–79% | <60% |

> Bolded norms are the ones the demo cases exercise most. N01, N10, S06-acyclicity, and
> the compliance roll-up are what flip PLAN-002 to Red.

---

## 2. Compliance scoring (Compliance agent)

**Inputs:** DS02 (8 components + weights, sum = 1.0), DS06 (per-plan section status).

**Per-section credit:**

| DS06 Status | Credit | Treatment |
|---|---|---|
| `Complete` | 1.0 × weight | full credit |
| `Weak` | 0.5 × weight | partial; listed as a gap (Medium) |
| `Missing` | 0.0 | gap (severity from the section's weight/role) |
| `Custom` | — | **excluded from score; flagged for PMO review — NOT a gap** |

```
compliance_score_pct = 100 × Σ(credit over the 8 required components)
                              ────────────────────────────────────────
                              Σ(weight of required components present in scope)   ( = 1.0 )
```

**Special rule (Risk pillar default):** if **S07 Risk_RAID is Missing**, the **Risk feasibility
pillar defaults to Red** regardless of other risk signals (Answer_Key F-01). `Risk_count = 0`
in DS07 ⇒ missing register.

**Custom sections:** a DS06 row with `Component_ID = NULL` and `Status = Custom` (e.g.
`EVM_Cost_Tracking`) → emit an `Info` flag "custom section — for PMO review", never a gap
(Answer_Key F-04).

## 3. Feasibility (Feasibility agent — fully deterministic)

### 3a. Resource busy-rate / capacity gap (N01)
- Per **member**: `DS03.Busy_rate` (already summed across projects). RAG via N01.
- Per **role**: peak demand vs `DS08` → `Peak_role_busy_rate_pct`. RAG via N01.
- A role with `DS08.Available_MD_month` near 0 + `Busy_rate_pct` high = **bottleneck** (DS08 `Note`).
- PLAN-002 peak ≈ 135% → 🔴 (F-03). Remember DS03 is a *snapshot* — absence ≠ availability.

### 3b. Dependency-logic validation (S06 — acyclic)
Build a directed graph from `DS01.Dependencies` (CSV of prerequisite Task_IDs) and check:
1. **Cycle detection** (DFS / topological sort). Any cycle → 🔴 dependency risk.
   - PLAN-002: `TASK-E07 ↔ TASK-E08` cycle (F-1C).
2. **Logical-order violations** — e.g. a Testing-phase task that is a prerequisite of a
   Development-phase task (test-before-build). PLAN-002: `TASK-E06` (F-1C).
3. Dangling dependency IDs (reference a Task_ID not in the plan) → data-quality flag.

### 3c. Timeline realism
- `Velocity_MD_month = Effort_MD / Duration_months` (DS07). Compare to the benchmark
  velocity for the same `Project_type` (§4). Plan velocity far above benchmark ⇒ timeline
  optimistic (🔴/🟡). PLAN-002: 47.3 MD/mo vs AI/ML benchmark ⇒ unrealistic.
- End_date < Start_date or milestones without dates → data-quality / S03 issues.

### 3d. THI (N10) — Synthesis input
`THI_pct = Non-dev_h / Total_h`. Green 15–25%. **PLAN-002 = 9% → 🔴** (too little budget for
testing/risk/quality work — tech-debt risk). PLAN-001 = 18% → 🟢.

## 4. Benchmark & Velocity (Benchmark agent — RAG + math)

1. **Find similar** historical projects (DS05) by `Project_type` + effort/duration/team profile,
   via vector similarity over `pmo.history_embeddings`. **Exclude** `Is_outlier = TRUE` and
   implausibly tiny projects (e.g. PRJ-H-199, 15 MD / 0.5 mo → F-06).
2. **Velocity comparison:** plan `Velocity_MD_month` vs the cohort's. PLAN-001 = 24 vs Migration
   benchmark ≈ 22.5 ⇒ feasible (F-05).
3. **On-time history (N07):** `On_time_history_pct`; <70% → 🔴.
4. **SPI / velocity variance (N08/N09)** where sprint data exists (DS04).
5. If fewer than *k* (e.g. 3) similar non-outlier projects exist → emit **"insufficient
   benchmark data"** and lower confidence rather than guessing.

## 5. Feasibility status roll-up (Synthesis agent)

Combine pillar RAGs into `Feasibility_status`. Pillars: **Compliance**, **Resource (busy/capacity)**,
**Timeline/Dependency**, **Benchmark/Velocity**, **THI**, **Risk**.

```
if any pillar is 🔴            → "Not feasible (Red)"   + the reason list
elif ≥1 pillar 🟡 or a cross-dimension conflict exists → "Needs review (Yellow / CAUTION)"
else                          → "Feasible (Green)"
```

**Cross-dimension conflict rule (the differentiator):** even if every pillar is individually
🟢/🟡, if two dimensions contradict (e.g. busy-rate acceptable but historical velocity ≪ plan),
the orchestrator forces **CAUTION** and Synthesis must reconcile and explain it before issuing
the DS07.

**Worked examples (must match DS07):**
- **PLAN-001** → all 8 sections present, busy 95%, THI 18%, velocity matches benchmark → **Feasible (Green)**.
- **PLAN-002** → Risk Register missing (Risk 🔴), peak busy 135% (🔴), THI 9% (🔴), dependency cycle (🔴),
  weak Resource_Plan & Acceptance_Criteria (Medium gaps), EVM_Cost_Tracking custom (Info) →
  **"Not feasible (Red): missing Risk Register; capacity gap (peak busy ~135%); THI 9% (<10%); weak Resource/Acceptance"**.

---

## 6. DS07 output schema (the deliverable contract)

The agent emits this structured object (header metrics mirror the DS07 sheet; arrays add the
detail). Use as the Zod/contract shape for `pmo.saveReviewReport` and the dashboard.

```jsonc
{
  "plan_id": "PLAN-002",
  "project_id": "PRJ-002",
  "project_name": "Energent AI (Data Platform)",
  // ---- header metrics (mirror DS07 sheet) ----
  "effort_md": 426,
  "duration_months": 9,
  "velocity_md_month": 47.3,
  "team_size": 10,
  "risk_count": 0,
  "top_risk_score": null,
  "thi_pct": 9,
  "peak_role_busy_rate_pct": 135,
  "on_time_history_pct": 90,
  "compliance_score_pct": 71,            // computed §2
  "feasibility_status": "Not feasible (Red)",
  "confidence": "high",                  // lowered if "insufficient benchmark data"
  // ---- detail arrays ----
  "gap_report": [
    { "section_code": "S07", "component": "Risk_RAID", "status": "Missing",
      "severity": "High", "evidence": { "source": "DS06", "row_id": "CHK-0xx" },
      "note": "Risk Register absent → Risk pillar defaults to Red" },
    { "section_code": "S05", "component": "Resource_Plan", "status": "Weak",
      "severity": "Medium", "evidence": { "source": "DS06", "row_id": "CHK-0xx" } }
  ],
  "custom_sections": [
    { "name": "EVM_Cost_Tracking", "action": "flag_for_pmo_review",
      "evidence": { "source": "DS06", "row_id": "CHK-0xx" } }
  ],
  "risk_warnings": [
    { "dimension": "Resource", "rag": "Red", "metric": "Busy Rate (N01)",
      "value_pct": 135, "threshold": ">120% = Red",
      "evidence": { "source": "DS03/DS08", "row_id": "…" },
      "why": "Peak role demand exceeds capacity by 35%; timeline assumes unavailable hours." },
    { "dimension": "Timeline/Dependency", "rag": "Red", "metric": "Acyclicity (S06)",
      "evidence": { "source": "DS01", "row_id": "TASK-E07,TASK-E08" },
      "why": "Cycle TASK-E07 ↔ TASK-E08; plus test-before-build (TASK-E06)." },
    { "dimension": "THI", "rag": "Red", "metric": "THI (N10)", "value_pct": 9,
      "threshold": "<10% = Red", "why": "Too little non-dev budget → tech-debt risk." }
  ],
  "benchmark": {
    "cohort_project_type": "AI/ML Platform",
    "similar_projects": ["PRJ-H-103", "PRJ-H-104"],
    "outliers_excluded": ["PRJ-H-199"],
    "velocity_deviation": "plan 47.3 MD/mo vs cohort ~?? — optimistic",
    "insufficient_data": false
  },
  "recommended_adjustments": [
    { "id": "R1", "action": "Add a Risk Register (S07) with ≥1 entry incl. severity + owner",
      "rationale": "Mandatory PMO section; unblocks Risk pillar.", "addresses": ["F-01"] },
    { "id": "R2", "action": "Rebalance the bottleneck role or extend the phase to bring peak busy ≤110%",
      "rationale": "135% busy is infeasible; check DS08 headroom before reassigning.", "addresses": ["F-03"] },
    { "id": "R3", "action": "Break the TASK-E07↔E08 cycle; sequence build before test (E06)",
      "rationale": "Dependency graph must be acyclic (S06).", "addresses": ["F-1C"] },
    { "id": "R4", "action": "Increase non-dev allocation to lift THI into 15–25%",
      "rationale": "THI 9% leaves no budget for quality/risk work.", "addresses": ["F-03"] }
  ],
  "audit": { "tools_run": [...], "incomplete_steps": [], "generated_at": "<ISO>" }
}
```

**Invariants:** every `gap_report`/`risk_warnings` entry carries an `evidence {source,row_id}`
(no-hallucination rule). `custom_sections` never appears in `gap_report`. `feasibility_status`
is derived strictly by §5.
