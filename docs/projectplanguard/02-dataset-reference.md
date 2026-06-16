# 02 — Dataset Reference (the data contract)

Source of truth: `PMO_01_ProjectPlan_Review.xlsx` (the only mock dataset aligned to PMO-01).
13 sheets. Shared masters (members, projects, KPI norms) are identical to the PMO-02 file.

> **Important grain note (from the legend):** DS03 is a *representative snapshot*. A plan's
> `Team_size` is the full planned headcount, so **not every team member appears in the current
> allocation window**. Do not assume DS03 lists the whole team.

---

## Sheet inventory & grain

| Sheet | 1 row = | Role in the agent |
|---|---|---|
| `LEGEND & SUMMARY` | data dictionary | reference only |
| `DS01_Project_Plan` | 1 task/milestone in a plan under review | **input** — the plan being reviewed |
| `DS02_PMO_Standard_Template` | 1 required component of the PMO template | compliance rules + weights |
| `DS03_Resource_Allocation` | 1 member × project allocation (snapshot) | feasibility (busy-rate) |
| `DS04_Velocity_History` | 1 sprint of a completed project | benchmark (velocity) — **embed for RAG** |
| `DS05_Historical_Projects` | 1 completed project (benchmark) | benchmark (effort/duration/risk) — **embed for RAG** |
| `DS06_Plan_Section_Check` | 1 template component checked vs a plan | compliance ground truth (status per section) |
| `DS07_Project_Plan_Summary` | 1 plan under review (header metrics) | **output target** + expected values |
| `DS08_Role_Capacity` | 1 role's current capacity | feasibility (capacity gap) |
| `REF_Member_Master` | 1 member (shared) | resolve `Assignee_id` / `Member_ID` |
| `REF_Project_Master` | 1 project (shared) | resolve `Project_ID`, historical flag |
| `REF_KPI_Norms` | 1 RAG metric threshold (SETA-08-SOP-001) | **all thresholds** (Green/Yellow/Red) |
| `Answer_Key` | 1 finding the agent should detect | **test oracle** — remove before any blind run |

---

## Field-level schema

### DS01_Project_Plan (the plan under review — 44 task rows across plans)
`Project_ID` (FK→Project_Master) · `Project_name` · `Task_ID` (unique within plan) ·
`Task_name` · `Assignee_id` (FK→Member_Master) · `Start_date` · `End_date` (≥ start) ·
`Effort_days` (float, sums to plan effort) · `Percent_complete` (0.0–1.0) ·
`Status` {Not Started / In Progress / Completed / Blocked / Delayed} ·
`Milestone_flag` (bool) · `Dependencies` (CSV of prerequisite Task_IDs — **may form a cycle**) ·
`Phase` {Discovery / Design / Development / Testing / Deployment} · `Risk_note`.

### DS02_PMO_Standard_Template (TPL-2026-v3, 8 components, weights sum to 1.0)
| Section | Component | Required | Validation rule | Weight |
|---|---|---|---|---|
| S01 | Scope | ✔ | Scope statement + in/out-of-scope list | 0.12 |
| S02 | Objectives | ✔ | ≥1 measurable objective (SMART) | 0.10 |
| S03 | Milestones | ✔ | All milestones have target dates | 0.12 |
| S04 | WBS_Effort | ✔ | Every WBS task has effort estimate | 0.13 |
| S05 | Resource_Plan | ✔ | Role × allocation table present | 0.13 |
| S06 | Dependencies | ✔ | **Dependency graph is acyclic** | 0.12 |
| S07 | Risk_RAID | ✔ | ≥1 risk entry with severity + owner | 0.16 |
| S08 | Acceptance_Criteria | ✔ | Each deliverable has measurable AC | 0.12 |

### DS03_Resource_Allocation
`Member_ID` (FK) · `Project_ID` (FK) · `Role` (BE/DE/ML/…) · `Allocation_pct` (share of std week) ·
`Start_date` · `End_date` · `Busy_rate` (**sum of the member's allocation across projects** — e.g. 1.25 = 125%).

### DS04_Velocity_History (embed for similarity)
`Project_ID` (FK) · `Project_type` · `Sprint_no` · `Sprint_duration_days` · `Planned_points` ·
`Completed_points` · `Velocity_ratio` (completed/planned) · `Team_size` · `Outcome`.

### DS05_Historical_Projects (embed for similarity)
`Historical_project_id` · `Project_type` (filter for similar benchmark) · `Team_size` ·
`Duration_days` · `Planned_duration_days` · `Total_effort_days` · `Total_budget_scaled` (1.0=baseline) ·
`Avg_velocity_ratio` · `Risk_count` · `Key_risks` · `PMO_standard_ver` ·
`Final_outcome` {On Time / Delayed / Cancelled / Early} · **`Is_outlier`** (TRUE = exclude from benchmarking).

### DS06_Plan_Section_Check (compliance ground truth)
`Check_ID` · `Plan_ID` · `Component_ID` (FK→DS02; NULL if custom) · `Custom_name` (when status=Custom) ·
`Status` {Complete / Weak / Missing / Custom} · `Note`.

### DS07_Project_Plan_Summary (OUTPUT — header metrics; see [05](05-feasibility-rules-and-ds07.md))
`Plan_ID` · `Project_ID` · `Project_name` · `Plan_set` · `Effort_MD` · `Duration_months` ·
`Velocity_MD_month` (effort/duration) · `Team_size` (planned peak) · `Risk_count` (0 = missing register) ·
`Top_risk_score` · `THI_pct` · `Peak_role_busy_rate_pct` · `On_time_history_pct` · `Feasibility_status`.

### DS08_Role_Capacity
`Capacity_ID` · `Role` · `Headcount` · `Capacity_MD_month` · `Busy_rate_pct` (current %) ·
`Available_MD_month` (spare) · `Note`.

### REF_KPI_Norms (thresholds — SETA-08-SOP-001)
Metrics relevant to **Problem 1 (us)**: N01 Busy Rate, N06 Effort Consumption, N07 On-time Delivery,
N08 SPI, N09 Velocity Variance, N10 THI, N11 Risk Closure Rate. (N02–N05, N12 are Problem-2 only.)
Exact thresholds in [05-feasibility-rules-and-ds07.md](05-feasibility-rules-and-ds07.md).

---

## Plans in the review queue (DS07 `To_Review`)

| Plan | Project | Effort_MD | Dur_mo | Vel_MD/mo | Team | Risks | THI% | PeakBusy% | OnTime% | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| PLAN-001 | Orion (Core Banking) | 168 | 7 | 24 | 16 | 5 | 18 | 95 | 92 | **Feasible (Green)** |
| PLAN-002 | Energent AI (Data) | 426 | 9 | 47.3 | 10 | 0 | 9 | 135 | 90 | **Not feasible (Red)** |
| PLAN-101 | Apollo | 157.5 | 7 | 22.5 | 6 | 6 | 18.9 | 103 | 94 | Feasible (Green) |
| PLAN-102 | Vega | 180 | 8 | 22.5 | 8 | 4 | 21.8 | 108 | 89 | Feasible (Green) |
| PLAN-103 | Lyra | 180 | 8 | 22.5 | 8 | 6 | 21.2 | 89 | 91 | Feasible (Green) |
| PLAN-104 | Draco | 140 | 5 | 28 | 12 | 4 | 17.9 | 96 | 93 | Feasible (Green) |

**PLAN-002 is the hero demo case** — it fails on multiple dimensions (missing Risk Register,
135% peak busy, THI 9%, dependency cycle). PLAN-001 is the clean baseline. See [07](07-test-and-uat.md).

## Foreign-key map (no DB-level FKs — resolve in app, per platform rule)

```
DS01.Assignee_id ──▶ REF_Member_Master.Member_ID
DS01.Project_ID  ──▶ REF_Project_Master.Project_ID
DS03.Member_ID   ──▶ REF_Member_Master.Member_ID
DS03.Project_ID  ──▶ REF_Project_Master.Project_ID
DS06.Component_ID──▶ DS02.Component_ID         (NULL ⇒ Custom section)
DS06.Plan_ID     ──▶ DS07.Plan_ID
DS04.Project_ID  ──▶ REF_Project_Master.Project_ID (Is_historical=TRUE)
DS05.Historical_project_id ──▶ REF_Project_Master.Project_ID
DS07.Project_ID  ──▶ REF_Project_Master.Project_ID
```

## Where the data lives (loading plan)

- **Origin:** shared S3 bucket → downloaded as `PMO_01_ProjectPlan_Review.xlsx`.
- **Target:** a new `pmo` Postgres schema (one table per DS sheet + REF tables). See [03](03-platform-mapping.md).
- **Loader:** a one-off `apps/cli` seed command (`pnpm … pmo:seed`) parsing the xlsx → inserts (idempotent, tenant-scoped).
- **RAG:** DS05 (and DS04 aggregates) embedded into a per-tenant pgvector table for benchmark similarity search by `Project_type` + effort/duration/team profile.
