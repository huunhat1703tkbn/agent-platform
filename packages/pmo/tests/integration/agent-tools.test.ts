import { requiredPermissionFor } from '@seta/agent-sdk';
import { makeToolContext } from '@seta/agent-sdk/testing';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import {
  pmoAgentTools,
  pmoBusyRateCalcTool,
  pmoDependencyValidatorTool,
  pmoSectionCheckerTool,
  pmoThiScorerTool,
} from '../../src/agent-tools.ts';
import { resetPmoDb, seedPmoDataset } from '../../src/index.ts';

const TENANT = '00000000-0000-0000-0000-0000000000bb';
const USER = '00000000-0000-0000-0000-0000000000cc';

function ctx() {
  return makeToolContext({ user_id: USER, tenant_id: TENANT });
}

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

describe('pmo read agent tools', () => {
  it('exposes the 4 read tools (pmo.plan.read) + the HITL write tool (pmo.review.write)', () => {
    expect(pmoAgentTools).toHaveLength(5);
    expect(requiredPermissionFor(pmoSectionCheckerTool)).toBe('pmo.plan.read');
    expect(requiredPermissionFor(pmoDependencyValidatorTool)).toBe('pmo.plan.read');
    expect(requiredPermissionFor(pmoBusyRateCalcTool)).toBe('pmo.plan.read');
    expect(requiredPermissionFor(pmoThiScorerTool)).toBe('pmo.plan.read');
  });

  it('pmo_sectionChecker scores compliance for a plan (F-01/02/04)', async () => {
    await withSeededDb(async () => {
      const out = (await pmoSectionCheckerTool.execute?.({ planId: 'PLAN-002' }, ctx())) as Awaited<
        ReturnType<NonNullable<typeof pmoSectionCheckerTool.execute>>
      > & { score_pct: number; risk_register_missing: boolean; gaps: unknown[] };

      expect(out.score_pct).toBeCloseTo(71.5, 5);
      expect(out.risk_register_missing).toBe(true);
      expect(out.custom_sections.map((c: { name: string }) => c.name)).toContain(
        'EVM_Cost_Tracking',
      );
    });
  });

  it('pmo_dependencyValidator finds the E07↔E08 cycle (F-1C)', async () => {
    await withSeededDb(async () => {
      const out = (await pmoDependencyValidatorTool.execute?.({ projectId: 'PRJ-002' }, ctx())) as {
        has_cycle: boolean;
        cycles: string[][];
      };
      expect(out.has_cycle).toBe(true);
      expect(new Set(out.cycles.flat())).toContain('TASK-E07');
    });
  });

  it('pmo_busyRateCalc flags peak busy 135% Red (F-03)', async () => {
    await withSeededDb(async () => {
      const out = (await pmoBusyRateCalcTool.execute?.({ planId: 'PLAN-002' }, ctx())) as {
        peak_role_busy_rate_pct: number;
        peak_rag: string;
      };
      expect(out.peak_role_busy_rate_pct).toBeCloseTo(135, 5);
      expect(out.peak_rag).toBe('Red');
    });
  });

  it('pmo_thiScorer computes THI from DS01 (Testing effort / total): PLAN-002 = 65/426 ≈ 15.3% Green', async () => {
    await withSeededDb(async () => {
      const out = (await pmoThiScorerTool.execute?.({ planId: 'PLAN-002' }, ctx())) as {
        thi_pct: number;
        rag: string;
      };
      // E06 (35) + E08 (30) Testing-phase effort over 426 total. The DS07 header (9%)
      // is a reference with error — raw data wins (E2E acceptance testing is non-dev).
      expect(out.thi_pct).toBe(15.3); // 65/426 = 15.258% → rounded to 1 dp
      expect(out.rag).toBe('Green');
    });
  });
});
