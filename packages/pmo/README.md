# @seta/pmo

> ProjectPlanGuard data + tools module (PMO-01). Owns the `pmo` Postgres schema (DS01–DS08 + REF
> + KPI norms + benchmark embeddings) and the deterministic review tools (compliance scoring,
> busy-rate, dependency-cycle, THI, benchmark similarity). The multi-agent orchestration that
> consumes these lives in the orchestrator layer. See `docs/projectplanguard/`.

## Public surface

- `@seta/pmo` — application services (Node)
- `@seta/pmo/events` — event type constants + zod payload schemas
- `@seta/pmo/rbac` — permission constants
- `@seta/pmo/contracts` — browser-safe DTOs + zod schemas
- `@seta/pmo/register` — `ContributionRegistry` hook (Node)

## RBAC

Module permissions are declared as a typed `statement` in `src/rbac.ts` and built into a
`ModuleRbacManifest` via `toManifest(...)`. They must also be mirrored into
`packages/shared-rbac/src/inventory.ts` (the `INVENTORY` array); run `pnpm gen:rbac` after.
See `packages/knowledge/src/rbac.ts` for a complete example.
