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
  it('exposes exactly the 4 read tools, each gated on pmo.plan.read', () => {
    expect(pmoAgentTools).toHaveLength(4);
    for (const tool of pmoAgentTools) {
      expect(requiredPermissionFor(tool)).toBe('pmo.plan.read');
    }
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

  it('pmo_thiScorer flags THI 9% Red (F-03)', async () => {
    await withSeededDb(async () => {
      const out = (await pmoThiScorerTool.execute?.({ planId: 'PLAN-002' }, ctx())) as {
        thi_pct: number;
        rag: string;
      };
      expect(out.thi_pct).toBeCloseTo(9, 5);
      expect(out.rag).toBe('Red');
    });
  });
});
