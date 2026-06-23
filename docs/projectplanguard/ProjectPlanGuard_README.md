# ProjectPlanGuard — PMO-01 Project Plan Review & Feasibility Agent

> **Team TESA** — SETA International Agentic AI Hackathon 2026 · Track: PMO
> An AI multi-agent system that reviews a project plan against PMO standards, detects
> **compliance gaps** and **feasibility risks** (resource load, timeline, dependencies,
> historical velocity), reconciles **cross-dimension conflicts**, and produces a
> **Project Plan Review Report** — keeping the PMO in control via a human approval step.

**Value:** turns a 3–5 hour manual, inconsistent review into a ~10–15 minute, evidence-grounded one.
**Core differentiator:** a plan can pass the compliance checklist yet still be infeasible — the agent
surfaces and explains that hidden conflict.

- **Live demo:** `https://team-1-hackathon.seta-international.com`
- **Deep-dive docs:** [`docs/projectplanguard/`](.) (problem, dataset, agent design, feasibility rules, plan).

---

## 1. Architecture at a glance

Built on the Seta modular monolith. One **Orchestrator** routes each chat turn to four
specialists, then a **Synthesis** step reconciles them into the final verdict:

```
"Review PLAN-002"
      │
      ▼
  Orchestrator ──▶ Compliance   (PMO template: missing/weak/custom sections)
      │        ──▶ Feasibility  (resource overload, THI, dependency cycles/order)
      │        ──▶ Benchmark    (velocity vs similar past projects, outliers excluded)
      │        ──▶ Synthesis    (roll-up verdict + cross-dimension conflict + recommendations)
      ▼
  Review report  ──▶  human approval (PMO)  ──▶  issued
```

| Layer | Technology |
|---|---|
| Agents / orchestration | Mastra (agent-of-agents), AI SDK v6, model `openai/gpt-5.5` |
| Backend | Hono (HTTP), Node 24, Turborepo + pnpm |
| Data | Postgres + pgvector, Drizzle ORM (`pmo` schema) |
| Frontend | React 19, TanStack Router, shadcn/ui, assistant-ui |
| Modules | `packages/pmo` (data + deterministic engine) · `packages/pmo-review` (orchestrator + sub-agents) |

Full design: [`04-agent-design.md`](04-agent-design.md) · [`03-platform-mapping.md`](03-platform-mapping.md) · [`05-feasibility-rules-and-ds07.md`](05-feasibility-rules-and-ds07.md).

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| **Node 24 LTS** | `node -v` must be ≥ 24. The repo pins `.nvmrc=24`. Older Node breaks `pnpm` (corepack). |
| **pnpm 11+** | Enabled via corepack (`corepack enable`). |
| **Docker** | For Postgres + pgvector (and Redis/observability) via Docker Compose. |
| **OpenAI API key** | **Required to boot** the API server (not just for chat) — see Setup step 2. |

---

## 3. Local setup

```bash
# 1. Clone your fork
git clone https://github.com/<your-org>/agent-platform.git
cd agent-platform

# 2. Configure environment
cp .env.example .env
#   Edit .env and set the three secrets:
#     BETTER_AUTH_SECRET=<any long random string>
#     CRYPTO_LOCAL_MASTER_KEY=<any long random string>
#     OPENAI_API_KEY=<your OpenAI key>          # REQUIRED — server crashes on boot without it
#   And comment out the empty mailer line (an empty value fails db:migrate):
#     # MAILER_DEFAULT_SMTP_URL=

# 3. Install dependencies
pnpm install

# 4. Start infrastructure (Postgres on :5542, etc.)
pnpm db:up

# 5. Apply database migrations
pnpm db:migrate

# 6. Seed the platform tenant + admin user (tenant: "hackathon")
pnpm db:seed

# 7. Load the PMO-01 dataset (plans PLAN-001, PLAN-002, PLAN-101..104) into the pmo schema
pnpm -F @seta/cli exec tsx src/index.ts pmo-seed --tenant hackathon

# 8. Run backend + frontend together
pnpm dev
```

| Service | URL |
|---|---|
| Frontend (web app) | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| Health check | http://localhost:3000/health/ready → `{"ok":true}` |

**Login:** `admin@hackathon.com` / `ChangeMe@2026`

### Common setup gotchas (verified)

| Symptom | Fix |
|---|---|
| `pnpm` crashes with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` | Node is < 24. Switch to Node 24 (`nvm use 24`). |
| `db:migrate` fails with `ZodError: invalid_format url` | Comment out `MAILER_DEFAULT_SMTP_URL=` in `.env` (empty string is not a valid URL). |
| API `:3000` won't start (`Missing model provider env vars: OPENAI_API_KEY`) | Set `OPENAI_API_KEY` in `.env` before `pnpm dev`. The key is required to boot, not only for chat. |
| `Plan "PLAN-002" not found. Available plans: (none)` in chat | Run the `pmo-seed` command (step 7) for the **same tenant** you log in as. |

---

## 4. How to use

1. Open http://localhost:5173 and log in.
2. **Via chat** (agent panel, right side):
   - `List the plans I can review.`
   - `Review PLAN-001` → expect **Feasible (Green)**.
   - `Review PLAN-002` → expect **Not feasible (Red)**: missing Risk Register, resource overload (~135% peak), dependency cycle.
   - `What are its main risks?` → follow-up using remembered context.
   - `Issue the report for PLAN-002` → an **approval card** appears; approve to issue (human-in-the-loop).
3. **Via dashboard:** open the **PMO → Review** screen (`/pmo/review`) — pick a plan to see the verdict banner, metric strip, gaps, risks, recommendations, benchmark, and the **Issue Report** approval panel.

---

## 5. Running tests

Tests run against a **real Postgres** (via testcontainers — Docker must be running).

```bash
# Deterministic engine (compliance, feasibility, benchmark, synthesis) vs the Answer_Key
pnpm --filter @seta/pmo test

# Orchestrator + sub-agents (routing, trust envelope, HITL composite)
pnpm --filter @seta/pmo-review test

# Whole repo
pnpm typecheck && pnpm lint && pnpm test
```

The `@seta/pmo` suite reproduces the dataset Answer_Key findings (F-01 missing Risk Register,
F-02 weak sections, F-03 resource overload, F-04 custom section flagged, F-05 healthy baseline,
F-06 outlier excluded, F-1C dependency cycle). See [`07-test-and-uat.md`](07-test-and-uat.md).

---

## 6. Deploy (CI/CD)

Push to the fork's default branch → GitHub Actions builds, pushes to ECR, and deploys to EC2;
the app serves at `https://team-1-hackathon.seta-international.com`.

Configure GitHub **Variables** (`ECR_REGISTRY`, `ECR_REPOSITORY`, `APP_DOMAIN`, `EC2_HOST`,
`EC2_USER`) and **Secrets** (`AWS_ECR_ACCESS_KEY_ID`, `AWS_ECR_SECRET_ACCESS_KEY`,
`EC2_SSH_PRIVATE_KEY`, `OPENAI_API_KEY`). Details in [`08-deliverables-and-deploy.md`](08-deliverables-and-deploy.md).

> 🔐 **Never commit secrets** (AWS credentials, SSH keys, API keys). They live in GitHub Secrets only.

---

## 7. Project structure

```
packages/
├── pmo/                         # FEATURE module — owns the data + deterministic engine
│   ├── src/backend/db/          #   pmo schema (DS01–DS08 + REF + KPI norms + review_report)
│   ├── src/backend/domain/      #   compliance, feasibility, benchmark, synthesis, plan-metrics
│   ├── src/backend/agent-tools/ #   read tools exposed to the agent
│   └── seed-data/               #   PMO-01 dataset fixtures + answer-key.json
└── pmo-review/                  # ORCHESTRATOR module — orchestrator + 4 specialist sub-agents
    └── src/backend/orchestration/
apps/
├── server/  apps/web/  apps/worker/  apps/cli/   # composition roots + CLI (pmo-seed lives here)
docs/projectplanguard/           # problem, dataset, design, feasibility rules, plan, UAT guide
```

---

## 8. Documentation index

| Doc | Use it for |
|---|---|
| [`01-problem-and-scope.md`](01-problem-and-scope.md) | Problem, personas, scope, hard constraints |
| [`02-dataset-reference.md`](02-dataset-reference.md) | The data contract (DS01–DS08, REF, KPI norms) |
| [`03-platform-mapping.md`](03-platform-mapping.md) | How the design maps onto the Seta platform |
| [`04-agent-design.md`](04-agent-design.md) | Orchestrator + 4 sub-agents, BDI, memory, failure handling |
| [`05-feasibility-rules-and-ds07.md`](05-feasibility-rules-and-ds07.md) | Scoring formulas + the report schema |
| [`06-implementation-plan.md`](06-implementation-plan.md) | Phased build plan + status |
| [`07-test-and-uat.md`](07-test-and-uat.md) | Test cases vs Answer_Key + UAT scenarios |
| [`08-deliverables-and-deploy.md`](08-deliverables-and-deploy.md) | Submission checklist + deploy |
| [`ProjectPlanGuard_UAT_Guide.md`](ProjectPlanGuard_UAT_Guide.md) | UAT guide for Advisory Board evaluators |
