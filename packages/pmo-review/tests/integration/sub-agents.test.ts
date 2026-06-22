import type { SpecializedAgentRunCtx } from '@seta/agent-sdk';
import { resetPmoDb, seedPmoDataset } from '@seta/pmo';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { makePmoReviewPort } from '../../src/backend/orchestration/adapters.ts';
import {
  makeBenchmarkAgent,
  makeComplianceAgent,
  makeFeasibilityAgent,
  makeSynthesisAgent,
} from '../../src/backend/orchestration/agents/index.ts';
import { resolveKnownPlan } from '../../src/backend/orchestration/plan-guard.ts';

const TENANT = '00000000-0000-0000-0000-0000000000ee';
const USER = '00000000-0000-0000-0000-0000000000ff';
const ctx: SpecializedAgentRunCtx = { tenantId: TENANT, actorUserId: USER };
const port = makePmoReviewPort();

async function withSeededDb(fn: () => Promise<void>): Promise<void> {
  await withTestDb(
    {
      templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
      baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
    },
    async ({ databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        await seedPmoDataset({ tenantId: TENANT });
        await fn();
      } finally {
        resetPmoDb();
        await closePools();
      }
    },
  );
}

describe('pmo-review sub-agents (deterministic engine wrappers)', () => {
  it('compliance sub-agent scores PLAN-002 (F-01: S07 missing) with a trust envelope', async () => {
    await withSeededDb(async () => {
      const agent = makeComplianceAgent({ port });
      const { result, trust } = await agent.run({ planId: 'PLAN-002' }, ctx);

      expect(result.score_pct).toBeCloseTo(71.5, 5);
      expect(result.risk_register_missing).toBe(true);

      expect(trust.reasoningTrace.length).toBeGreaterThan(0);
      expect(trust.evidenceCitations.some((c) => c.id === 'PLAN-002')).toBe(true);
      expect(trust.confidenceScore).toBeGreaterThan(0);
    });
  });

  it('feasibility sub-agent folds busy + THI + dependency cycle for PLAN-002', async () => {
    await withSeededDb(async () => {
      const agent = makeFeasibilityAgent({ port });
      const { result, trust } = await agent.run({ planId: 'PLAN-002' }, ctx);

      expect(result.busy.peak_rag).toBe('Red');
      expect(result.busy.peak_role_busy_rate_pct).toBeCloseTo(135, 5);
      // THI computed from DS01 (Testing/total = 15.3%) is Green; busy + cycle carry the Red.
      expect(result.thi.rag).toBe('Green');
      expect(result.deps.has_cycle).toBe(true);
      expect(trust.confidenceScore).toBeGreaterThan(0);
    });
  });

  it('benchmark sub-agent excludes the outlier (F-06) for PLAN-002', async () => {
    await withSeededDb(async () => {
      const agent = makeBenchmarkAgent({ port });
      const { result, trust } = await agent.run({ planId: 'PLAN-002' }, ctx);

      expect(result.outliers_excluded).toContain('PRJ-H-199');
      expect(trust.reasoningTrace.length).toBeGreaterThan(0);
    });
  });

  it('listPlans + resolveKnownPlan: real plans are known, a bogus id is not', async () => {
    await withSeededDb(async () => {
      const plans = await port.listPlans({ tenantId: TENANT });
      expect(plans.map((p) => p.planId)).toContain('PLAN-002');

      expect((await resolveKnownPlan(port, TENANT, 'PLAN-002')).known).toBe(true);

      const bad = await resolveKnownPlan(port, TENANT, 'PLAN-999');
      expect(bad.known).toBe(false);
      expect(bad.available).toContain('PLAN-002');
    });
  });

  it('synthesis sub-agent produces the DS07 verdict; confidence tracks data sufficiency', async () => {
    await withSeededDb(async () => {
      const agent = makeSynthesisAgent({ port });

      const red = await agent.run({ planId: 'PLAN-002' }, ctx);
      expect(red.result.feasibility_status).toBe('Not feasible (Red)');
      expect(red.trust.confidenceScore).toBeGreaterThan(0);

      // PLAN-001 is clean (100% compliant, no gaps) but its span/30 velocity runs ~18%
      // over the cohort → Benchmark Yellow → "Needs review (Yellow)" rather than Green.
      const clean = await agent.run({ planId: 'PLAN-001' }, ctx);
      expect(clean.result.feasibility_status).toBe('Needs review (Yellow)');
      // every claim is sourced: the report's pillars carry the cited dimensions
      expect(clean.trust.evidenceCitations.some((c) => c.id === 'PLAN-001')).toBe(true);
    });
  });
});
