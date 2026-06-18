import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import {
  assessBusyRate,
  assessThi,
  resetPmoDb,
  scoreCompliance,
  seedPmoDataset,
  validateDependencies,
} from '../../src/index.ts';

// Deterministic feasibility/compliance core, graded against the dataset Answer_Key
// (docs/projectplanguard/07-test-and-uat.md → seed-data/answer-key.json).
const TENANT = '00000000-0000-0000-0000-0000000000aa';

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

describe('ProjectPlanGuard deterministic core vs Answer_Key', () => {
  it('PLAN-002 compliance: Missing S07 (F-01), Weak S05/S08 (F-02), Custom EVM (F-04)', async () => {
    await withSeededDb(async () => {
      const r = await scoreCompliance({ tenantId: TENANT, planId: 'PLAN-002' });

      expect(r.score_pct).toBeCloseTo(71.5, 5);

      // F-01: Risk Register missing → High gap + risk-pillar-default signal.
      expect(r.risk_register_missing).toBe(true);
      expect(r.gaps.find((g) => g.section_code === 'S07')).toMatchObject({
        status: 'Missing',
        severity: 'High',
      });

      // F-02: Resource_Plan (S05) + Acceptance_Criteria (S08) weak → Medium.
      const weak = r.gaps
        .filter((g) => g.status === 'Weak')
        .map((g) => g.section_code)
        .sort();
      expect(weak).toEqual(['S05', 'S08']);

      // F-04: EVM_Cost_Tracking is custom → flagged, never a gap.
      expect(r.custom_sections.map((c) => c.name)).toContain('EVM_Cost_Tracking');
      expect(r.gaps.some((g) => g.custom_name === 'EVM_Cost_Tracking')).toBe(false);
    });
  });

  it('PLAN-001 compliance: all 8 sections complete → 100%, no gaps (F-05)', async () => {
    await withSeededDb(async () => {
      const r = await scoreCompliance({ tenantId: TENANT, planId: 'PLAN-001' });
      expect(r.score_pct).toBeCloseTo(100, 5);
      expect(r.gaps).toHaveLength(0);
      expect(r.risk_register_missing).toBe(false);
    });
  });

  it('PLAN-002 dependencies: E07↔E08 cycle + deploy-before-test order violation (F-1C)', async () => {
    await withSeededDb(async () => {
      const r = await validateDependencies({ tenantId: TENANT, projectId: 'PRJ-002' });
      expect(r.has_cycle).toBe(true);
      const members = new Set(r.cycles.flat());
      expect(members.has('TASK-E07')).toBe(true);
      expect(members.has('TASK-E08')).toBe(true);
      expect(
        r.order_violations.some((v) => v.task_id === 'TASK-E08' && v.depends_on === 'TASK-E07'),
      ).toBe(true);
    });
  });

  it('PLAN-001 dependencies: acyclic, no order violations (F-05 baseline)', async () => {
    await withSeededDb(async () => {
      const r = await validateDependencies({ tenantId: TENANT, projectId: 'PRJ-001' });
      expect(r.has_cycle).toBe(false);
      expect(r.order_violations).toHaveLength(0);
    });
  });

  it('PLAN-002 feasibility: peak busy ~135% Red + THI 9% Red (F-03)', async () => {
    await withSeededDb(async () => {
      const busy = await assessBusyRate({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(busy.peak_role_busy_rate_pct).toBeCloseTo(135, 5);
      expect(busy.peak_rag).toBe('Red');
      // member-level busy computed from DS03 (EMP-004 = 125%) is also Red.
      expect(busy.max_member_rag).toBe('Red');

      const thi = await assessThi({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(thi.thi_pct).toBeCloseTo(9, 5);
      expect(thi.rag).toBe('Red');
    });
  });

  it('PLAN-001 feasibility: busy 95% Green + THI 18% Green', async () => {
    await withSeededDb(async () => {
      const busy = await assessBusyRate({ tenantId: TENANT, planId: 'PLAN-001' });
      expect(busy.peak_rag).toBe('Green');
      const thi = await assessThi({ tenantId: TENANT, planId: 'PLAN-001' });
      expect(thi.rag).toBe('Green');
    });
  });
});
