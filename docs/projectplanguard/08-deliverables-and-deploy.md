# 08 — Deliverables & Deploy

From `SETA_Hackathon_2026_POC_Template.docx`, `SETA_Hackathon_2026_UAT_Guide.docx`, `DEPLOY.md`.

---

## 1. Submission checklist (due 23 Jun 2026, 23:59 GMT+7)

| # | Item | Format | Owner | Status |
|---|---|---|---|---|
| 1 | Presentation slides | PDF/PPTX, **8-slide structure** | | ☐ |
| 2 | Source code | GitHub repo link (the fork) | | ☐ |
| 3 | Documentation | README with setup + run instructions | | ☐ |
| 4 | Backup demo video | MP4 / YouTube, **3–5 min** (mandatory) | | ☐ |
| 5 | Architecture diagram | in slides or separate file | | ☐ |
| 6 | UAT guide for evaluators | **PDF, max 3 pages** | | ☐ |
| 7 | Supplementary technical docs | optional (this folder!) | | ☐ |

## 2. Final presentation format (28 Jun)

- **Part 1 — Slides:** 10 min. **Part 2 — Live demo:** 10 min.

### Mandatory 8-slide structure (with our content)

| # | Slide | Time | Our content |
|---|---|---|---|
| 1 | Opening / elevator pitch | 0:20 | "For PMO analysts, ProjectPlanGuard reviews project plans for compliance + feasibility before kickoff, cutting 3–5 h to 10–15 min." Team TESA, 3 members + roles |
| 2 | Problem statement | 1:20 | Manual review pain ([01](01-problem-and-scope.md)); cross-dimension conflict insight; affected = PMO/PM/lead |
| 3 | Solution overview | 1:20 | Multi-agent review → DS07; why agent (4 interdependent dimensions); user journey |
| 4 | **Architecture & stack** | 2:00 | **Diagram mandatory** — Seta orchestrator + 4 sub-agents; LLM `openai/gpt-5.5` (rationale: structured-JSON + multi-step reasoning); Mastra; pgvector RAG; Postgres; ECS/EC2 deploy |
| 5 | **Agentic design** | 2:00 | BDI; reasoning/planning/memory/tool-selection/autonomy/multi-agent coordination ([04](04-agent-design.md)) |
| 6 | Proposal vs reality | 1:00 | What we built vs proposal; the stack decision D1; trade-offs |
| 7 | **Results & metrics** | 1:30 | Accuracy vs Answer_Key (findings/7); speed (s/plan); 3–5 h → minutes; test coverage (scenarios); 5 edge categories — **every metric needs evidence** (screenshots/logs) |
| 8 | Closing | 0:30 | Lessons; future (Jira integration, what-if sim); memorable line |

### Live demo structure (20 min total → 10 demo)

| Phase | Time | Our run |
|---|---|---|
| 1 Context setup | 1 min | Demo env = deployed URL; data = mock PMO-01; show plan picker |
| 2 Core flow | 3 min | Review **PLAN-001** (green) → DS07 |
| 3 Advanced | 3 min | Review **PLAN-002** (red) → multi-agent, cross-dimension conflict, recommendations, PMO approval |
| 4 Error/edge | 2 min | Out-of-scope question; tool-timeout partial DS07; ambiguous → clarification |
| 5 Open | 1 min | Judge's request |

**Backup policy:** live fail → one restart allowed; can't continue → backup video (score deduction); no demo → demo scored zero. **Record the backup video.**

## 3. UAT guide (PDF, max 3 pages, business language)

Required sections (content drafted in [07](07-test-and-uat.md)):
1. **Access info** — system URL, test credentials, browser, env, **list of agents + roles** (multi-agent).
2. **Test scenarios** — 5–8 (Cat A ≥2, B ≥2, C ≥1) with numbered steps + screenshots + expected output.
3. **Mapping to slide-7 metrics.**
4. **Known limitations** ([07 §3](07-test-and-uat.md)).
5. **Quick reference** — agent map, sample conversation log, optional QR/video.

Tone: "talk to it like a smart colleague"; expect 30–90 s thinking; wording varies, meaning is what matters.

---

## 4. Deploy (from `DEPLOY.md` — no secrets here)

| Item | Value |
|---|---|
| Live URL | `https://team-1-hackathon.seta-international.com` |
| EC2 | `54.169.235.50` (Docker + AWS CLI pre-bootstrapped, user `team-1`) |
| ECR | `033484686020.dkr.ecr.ap-southeast-1.amazonaws.com` / `hackathon-team-1` |
| Region | `ap-southeast-1` |
| CI/CD | GitHub Actions in the fork → build → push ECR → deploy EC2 |

**Setup once:** fork `Seta-International/agent-platform`; set GitHub **Variables**
(`ECR_REGISTRY`, `ECR_REPOSITORY`, `APP_DOMAIN`, `EC2_HOST`, `EC2_USER`) and **Secrets**
(`AWS_ECR_ACCESS_KEY_ID`, `AWS_ECR_SECRET_ACCESS_KEY`, `EC2_SSH_PRIVATE_KEY`, `OPENAI_API_KEY`)
— all secret values from `AWS-CREDENTIALS.txt` / the `team-1` key file. DB password, auth
secret, encryption key auto-generate on EC2 first deploy (`/opt/seta/secrets.env`).

> 🔐 **Security:** `AWS-CREDENTIALS.txt` and the `team-1` SSH private key are secrets. They go
> into **GitHub Secrets only** — never committed to the repo, never pasted into docs, slides,
> or the video. Add them to `.gitignore` if they ever land in the working tree.

**Keep alive during Advisory Board testing** — any downtime / credential issue → notify organizers.

---

## 5. README (item 3) — outline to write at submission

`clone → fork setup → local: pnpm install · db:up · db:migrate · tenant-bootstrap · pmo:seed · dev`;
how to review a plan (chat "Review PLAN-002"); the DS07 dashboard; how to run tests
(`pnpm test`); architecture diagram; link to this `docs/projectplanguard/` folder as the deep-dive.
