# 06 — Implementation Plan

Phased build to the **23 Jun submission**. Today = 2026-06-12 (~11 days). Maps the proposal's
2-week plan onto concrete Seta tasks. Verify gate after every phase:
`pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm test:e2e` if web changed).

---

## Milestones

| Phase | Days | Goal | Demo-able output |
|---|---|---|---|
| **P0 — Setup** | Jun 12–13 | Repo running locally; deploy pipeline green; data loaded | `db:migrate` + `pmo:seed` populate the `pmo` schema |
| **P1 — Compliance + Feasibility** | Jun 14–17 | Deterministic core + 2 agents | Upload PLAN-002 → gap report + feasibility risks (no LLM polish) |
| **P2 — Benchmark + Synthesis** | Jun 18–20 | RAG + reasoning + DS07 + HITL | End-to-end: chat → DS07 draft → PMO approval card |
| **P3 — UI + harden + tests** | Jun 21–22 | DS07 dashboard, edge cases, test suite vs Answer_Key | Live demo path + UAT scenarios pass |
| **P4 — Submit** | Jun 23 | Slides, video, README, UAT PDF, final deploy | All checklist items submitted |

---

## P0 — Setup (Jun 12–13)

> **✅ Status (built 2026-06-18):** Local env running (see [09](09-local-setup-notes.md)).
> `pmo` feature module scaffolded + wired into server/worker/cli. Schema for all 12 tables
> (DS01–DS08 + REF + KPI norms + `review_report`) defined, migration `0000_*.sql` applied
> (`pmo` schema live). Dataset converted to JSON fixtures (`packages/pmo/seed-data/pmo01.json`
> + `answer-key.json`) and loaded via `seta-cli pmo-seed --tenant hackathon` (idempotent;
> verified: PLAN-002=Red, cycle E07↔E08, DS06 1 Missing/1 Custom/2 Weak). Verify green:
> pmo+cli typecheck, contract test, depcruise (0 errors), module-shape, rbac-coverage, boot 200.
>
> **Follow-ups before merge:** (1) replace placeholder RBAC (`pmo.example`/`pmo.viewer`) with real
> perms (`pmo.plan.read`, `pmo.review.write`, …) **mirrored into `packages/shared-rbac/src/inventory.ts`**
> + add a parity test; (2) add DS07 DTOs in `contracts.ts` (clears the `no-orphan` depcruise warning);
> (3) web companion deferred to P3.

- [ ] Fork `Seta-International/agent-platform`; configure GitHub Actions vars/secrets per `DEPLOY.md` (secrets from `AWS-CREDENTIALS.txt`, **never commit**).
- [ ] Local stack: `pnpm install` → `pnpm db:up` → `pnpm db:migrate` → `bash scripts/tenant-bootstrap.sh` → `pnpm dev`. Confirm `/health/ready` 200.
- [ ] First deploy to `team-1-hackathon.seta-international.com` to prove the pipeline early.
- [ ] `pnpm gen module` → **`pmo`** (feature, web companion Y).
- [ ] Define the `pmo` schema in `schema.ts`: one table per DS sheet (`ds01_tasks`, `ds02_template`, `ds03_alloc`, `ds04_velocity`, `ds05_history`, `ds06_section_check`, `ds07_report`, `ds08_capacity`, `ref_member`, `ref_project`, `kpi_norms`) + `history_embeddings` (pgvector). No cross-schema FKs.
- [ ] `pnpm --filter @seta/pmo db:generate && pnpm db:migrate`.
- [ ] Write `apps/cli` seed (`pmo:seed`): parse `PMO_01_ProjectPlan_Review.xlsx` → idempotent insert, tenant-scoped. (Keep the xlsx out of git; load from a local path / S3.)

## P1 — Compliance + Feasibility (Jun 14–17)

Deterministic-first: get the numbers exact before any LLM.

> **✅ Status (built 2026-06-18):** Deterministic core landed in `packages/pmo/src/backend/domain/`
> (`rag.ts`, `compliance.ts`, `dependencies.ts`, `feasibility.ts`), exported from the public surface.
> Verify green: pmo typecheck, full `pnpm lint` (depcruise/styles/raw-sql/boundaries/rbac-coverage/biome),
> 23 tests pass — 16 unit (pure RAG/compliance/dependency) + 6 integration vs Answer_Key on real
> Postgres (testcontainers, template `platform_template_pmo`) + 1 contract. Findings reproduced:
> F-01 (S07 Missing→High gap + risk-pillar-default), F-02 (S05/S08 Weak→Medium), F-03 (peak busy
> 135% + member 125% + THI 9% all Red), F-04 (EVM custom→flag, not a gap), F-05 (PLAN-001 100% /
> acyclic / Green), F-1C (E07↔E08 cycle via Tarjan SCC + deploy-before-test order violation).
> Note: `peak_role_busy_rate_pct` and `thi_pct` are DS07 header metrics (not derivable from the
> normalised raw sheets) — the deterministic layer classifies them via N01/N10, while per-member
> busy rate is computed directly from DS03.
>
> **Update (chunk A):** Real RBAC landed — `pmo.plan.read` / `pmo.review.{read,write}` with
> `pmo.reviewer` + `pmo.viewer` roles, mirrored into `shared-rbac/inventory.ts`, regenerated via
> `pnpm gen:rbac`, parity-tested. The 4 read tools are authored + registered (`reg.module agentTools`).
> 29 pmo tests pass; full `pnpm typecheck` + `pnpm lint` green repo-wide.
> **Next:** Compliance + Feasibility sub-agents → Benchmark/Synthesis + orchestrator + HITL (P2).

- [x] `pmo` domain functions (pure, unit-tested vs [05](05-feasibility-rules-and-ds07.md)):
  - [x] `scoreCompliance(planId)` — DS06 × DS02 weights, custom-exclusion, S07-missing default.
  - [x] `assessBusyRate(planId)` — N01 per-member (DS03) + role peak (DS07). Capacity-gap (DS08) deferred to Synthesis.
  - [x] `validateDependencies(projectId)` — cycle detection (Tarjan SCC) + phase-order violations from DS01.
  - [x] `assessThi(planId)` — N10.
- [x] Expose as agent tools: `pmo_sectionChecker`, `pmo_busyRateCalc`, `pmo_dependencyValidator`, `pmo_thiScorer` (read tools).
- [ ] Compliance + Feasibility sub-agents (Compliance hybrid for semantic matching; Feasibility deterministic).
- [x] **Integration tests vs Answer_Key** F-01, F-02, F-03, F-1C, F-05 (real Postgres via testcontainers).

## P2 — Benchmark + Synthesis + HITL (Jun 18–20)

> **✅ Status (built 2026-06-18):** Deterministic Benchmark + Synthesis + HITL write landed in
> `packages/pmo/src/backend/domain/` (`benchmark.ts`, `synthesis.ts`, `save-review-report.ts`).
> `buildReviewReport(planId)` composes all pillars into the DS07 object and applies the §5 roll-up
> incl. the cross-dimension conflict rule; verified vs ground truth (PLAN-002 → "Not feasible (Red)",
> PLAN-001 → "Feasible (Green)") and F-05/F-06. `saveReviewReport` writes `review_report` + emits
> `pmo.report.issued` in one outbox transaction (HITL `needsApproval` on the `pmo_saveReviewReport`
> tool). 46 pmo tests pass; full `pnpm typecheck` + `pnpm lint` green repo-wide.
>
> **Remaining (next chunk):** the Mastra `pmo-review` LLM orchestrator + sub-agents wrapping this
> deterministic engine, vector-similarity benchmarking (currently a deterministic cohort-by-type),
> and the apps/server orchestration wiring. The DS07 deliverable is fully producible today via
> `buildReviewReport` / `pmo_saveReviewReport`.

- [ ] Embed DS05 (+ DS04 aggregates) into `pmo.history_embeddings` via `@seta/shared-embeddings`; `apps/cli` backfill. *(deferred — deterministic cohort-by-type covers F-05/F-06 for now.)*
- [x] `findSimilarProjects(planId)` — `selectCohort` by `project_type`, outlier + tiny-project exclusion (F-06). *(vector `Retriever` is the enhancement above.)*
- [x] `velocityComparator(planId)` — `compareVelocity` deviation math + N07 on-time classify.
- [x] **Synthesis & Recommendation** (deterministic): `buildReviewReport` roll-up §5, cross-dimension conflict, recommendations → DS07 object ([05 §6](05-feasibility-rules-and-ds07.md)). LLM reasoning tier wraps this next.
- [ ] Orchestrator (`pmo-review`, staffing pattern): route → parallel Compliance+Feasibility → Benchmark → Synthesis → **post-step records HITL approval card** (DS07 preview).
- [x] `pmo.saveReviewReport` write (HITL `needsApproval: true`) → writes `review_report` row + emits `pmo.report.issued`.
- [ ] Wire orchestration at `apps/server` composition root (inject `chatOrchestration`). *(read+write tools already registered via `reg.module`.)*

## P3 — UI + harden + tests (Jun 21–22)

> **✅ Status (built 2026-06-18):** DS07 dashboard web companion landed at `/pmo/review`
> (`apps/web/src/modules/pmo/`): plan picker → verdict banner (feasibility status + reason +
> confidence + cross-dimension conflict callout), header metric strip (compliance, peak busy, THI,
> velocity, on-time, risks — RAG-tinted), pillar badges, and tabs for Gaps / Risks / Recommendations
> / Benchmark, plus the **PMO "Issue DS07 Report" approval panel**. Backed by `@seta/pmo/http`
> routes (`GET /pmo/plans`, `GET/POST /pmo/plans/:id/review`, RBAC-gated) wired in apps/server;
> nav manifest registered. Composes `@seta/shared-ui` only (no custom CSS). Verified: full
> `pnpm typecheck` + `pnpm lint` green; 47 pmo tests pass. **Remaining:** run the live app for a
> visual pass + screenshots for slides.

- [x] Web companion: plan picker → **DS07 dashboard** (compliance, THI, feasibility status, gap table, risk warnings, recommendations, benchmark) + PMO review/approve panel. Composes `@seta/shared-ui` only.
- [ ] Edge/failure cases ([04 §5](04-agent-design.md)): tool timeout → partial DS07; missing mandatory section → PMO checkpoint; ambiguous input → clarification; insufficient benchmark data.
- [ ] Full test pass: unit (formulas) + integration (Answer_Key) + e2e (upload→DS07). Record accuracy vs Answer_Key for slide 7.
- [ ] Latency check: target < 15 min (realistically seconds) per plan; capture numbers for slide 7.

## P4 — Submit (Jun 23)

See [08-deliverables-and-deploy.md](08-deliverables-and-deploy.md). Final deploy, smoke test the live URL, record backup video, finalise slides + UAT PDF + README.

---

## Risk register (build risks)

| Risk | Mitigation |
|---|---|
| Mastra/orchestrator learning curve | Copy `packages/staffing/` structure verbatim; consult `../mastra/` for API names |
| Formula drift vs Answer_Key | Lock formulas in [05](05-feasibility-rules-and-ds07.md); unit-test each before agent wiring |
| Scope creep (nice-to-haves) | What-if simulation & drill-down are **only if core flow done** (proposal §5.2) |
| Deploy fails on demo day | Prove pipeline in P0; keep backup video (mandatory); one restart allowed |
| Few historical projects weaken benchmark | "Insufficient benchmark data" path + confidence downgrade, never guess |

## Ownership (3 members — suggested split)

| Member | Area |
|---|---|
| Trương Hữu Nhật | `pmo` data layer + deterministic feasibility/compliance + tests |
| Dương Quang Thanh | Orchestrator + sub-agents (Benchmark RAG, Synthesis) + HITL wiring |
| Bùi Ánh Dương | Web DS07 dashboard + PMO panel + slides/UAT/video |
