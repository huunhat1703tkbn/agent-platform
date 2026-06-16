# ProjectPlanGuard — PMO-01 Project Plan Review & Feasibility Validation Agent

> **Team TESA** — Transforming Enterprise Systems with Agents
> Trương Hữu Nhật · Dương Quang Thanh · Bùi Ánh Dương
> SETA International Agentic AI Hackathon 2026 · Track: Project Management Office (PMO)

This folder is the **single source of context** for building ProjectPlanGuard on the
Seta agent platform. Every doc here is written to be re-fed into a coding session as
grounding context — read this index first, then open the doc for the decision you're making.

---

## What we are building (one line)

An AI agent that reviews a project plan against PMO standards, detects **compliance gaps**
and **feasibility risks** (resource, timeline, dependency, historical velocity), reconciles
**cross-dimension conflicts**, and produces a **DS07 review report** — keeping the PMO in
control through human-in-the-loop checkpoints.

**Core differentiator:** a plan can pass the compliance checklist yet still be infeasible.
The value is *cross-dimension reconciliation* — e.g. busy-rate looks fine (95%) while the
same team's historical velocity is 62% of plan. Checklist tools miss this; our agent surfaces
and explains it.

---

## Document map

| Doc | Use it when you need… |
|---|---|
| [01-problem-and-scope.md](01-problem-and-scope.md) | The problem statement, in/out scope, personas, value targets, deadlines |
| [02-dataset-reference.md](02-dataset-reference.md) | The exact data contract — DS01–DS08, REF, KPI norms, FKs, where the data lives |
| [03-platform-mapping.md](03-platform-mapping.md) | How ProjectPlanGuard maps onto Seta (modules, schema, orchestrator) + the **stack decision** |
| [04-agent-design.md](04-agent-design.md) | Orchestrator + 4 sub-agents, BDI model, agent flow, failure handling, memory |
| [05-feasibility-rules-and-ds07.md](05-feasibility-rules-and-ds07.md) | The **scoring formulas** + the DS07 output schema (the computational core) |
| [06-implementation-plan.md](06-implementation-plan.md) | Phased build plan, `pnpm gen module` steps, day-by-day to 23 Jun |
| [07-test-and-uat.md](07-test-and-uat.md) | Test cases derived from the Answer_Key + the UAT scenario plan |
| [08-deliverables-and-deploy.md](08-deliverables-and-deploy.md) | Submission checklist, 8-slide map, deploy pipeline (no secrets) |

---

## Quick facts

| | |
|---|---|
| **Problem ID** | PMO-01 |
| **Mock dataset** | `PMO_01_ProjectPlan_Review.xlsx` (13 sheets) — see [02](02-dataset-reference.md) |
| **Output artifact** | DS07 Project Plan Review Report (JSON + dashboard) |
| **Target latency** | 3–5 hours manual → 10–15 minutes per plan |
| **Platform** | Seta modular monolith — Hono · Mastra · Drizzle · Postgres+pgvector · AI SDK v6 · React 19 |
| **Reference orchestrator** | `packages/staffing/` (agent-of-agents) — our template |
| **Deploy target** | `https://team-1-hackathon.seta-international.com` (GitHub Actions → ECR → EC2) |

## Key dates (today = 2026-06-12)

| Milestone | Date |
|---|---|
| Build period | 11–23 Jun 2026 |
| **Submission deadline** | **23 Jun 2026, 23:59 GMT+7** (~11 days left) |
| Final presentation & live demo | 28 Jun 2026 |

---

## Decision log

Decisions that shape the build. Append here when a material choice is made.

| # | Decision | Rationale | Status |
|---|---|---|---|
| D1 | **Build on the Seta platform (Mastra/Hono/Drizzle), not the proposal's FastAPI/LangGraph/Next.js stack** | The assignment is to build on the boilerplate; the platform's `staffing` orchestrator already implements agent-of-agents + HITL + pgvector RAG. See [03](03-platform-mapping.md). | ✅ Adopted |
| D2 | **Data lives in a new `pmo` module schema** (DS01–DS08, REF as tables); historical projects (DS04/DS05) embedded into a per-tenant pgvector table for benchmark similarity | Respects module-boundary rules; reuses the embeddings/retrieval stack | ✅ Adopted |
| D3 | **Orchestration follows the staffing pattern** — orchestrator delegates to Compliance / Feasibility / Benchmark / Synthesis sub-agents; deterministic stages skip the LLM | Matches platform's proven chat-runtime shape; deterministic scoring is auditable | ✅ Adopted |
| D4 | **DS07 report generation is the terminal write, gated by a HITL approval card** | Platform rule: HITL on every write; PMO keeps final approval | ✅ Adopted |
| D5 | LLM model | Platform default is `openai/gpt-5.5` via `AGENT_MODELS`; proposal said "GPT-4-class". Use the platform default; reasoning tier for Synthesis. | 🔶 Confirm with organizer key |

---

## Source materials (local, do NOT commit)

These live in `/Users/kevintruong/Downloads/team-1/` and contain secrets — **never commit**:

- `PMO_01_ProjectPlan_Review.xlsx` — the mock dataset (the only one aligned to our problem)
- `TESA_PMO01_Proposal.pdf` — our submitted proposal
- `SETA_Hackathon_2026_POC_Template.docx` — slide + demo template
- `SETA_Hackathon_2026_UAT_Guide.docx` — UAT requirements
- `DEPLOY.md` — deploy runbook
- ⚠️ `AWS-CREDENTIALS.txt` and `team-1` (SSH private key) — **secrets; keep out of git**
