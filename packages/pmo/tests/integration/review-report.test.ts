import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { buildReviewReport } from '../../src/backend/domain/synthesis.ts';
import { resetPmoDb, seedPmoDataset } from '../../src/index.ts';

const TENANT = '00000000-0000-0000-0000-0000000000dd';

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

describe('buildReviewReport (DS07 synthesis vs ground truth)', () => {
  it('PLAN-002 → Not feasible (Red) with the expected reason set', async () => {
    await withSeededDb(async () => {
      const r = await buildReviewReport({ tenantId: TENANT, planId: 'PLAN-002' });

      expect(r.feasibility_status).toBe('Not feasible (Red)');
      expect(r.feasibility_reason).toMatch(/Risk Register|missing/i);

      const red = new Set(r.pillars.filter((p) => p.rag === 'Red').map((p) => p.dimension));
      expect(red).toContain('Resource');
      expect(red).toContain('THI');
      expect(red).toContain('Risk');
      expect(red).toContain('Timeline/Dependency');

      // header metrics mirror DS07
      expect(r.compliance_score_pct).toBeCloseTo(71.5, 5);
      expect(r.thi_pct).toBeCloseTo(9, 5);
      expect(r.peak_role_busy_rate_pct).toBeCloseTo(135, 5);

      // risk warnings + recommendations carry evidence and address the findings
      expect(r.risk_warnings.some((w) => w.dimension === 'Risk')).toBe(true);
      expect(r.recommended_adjustments.some((a) => a.addresses.includes('F-01'))).toBe(true);

      // benchmark cohort excludes the outlier (F-06)
      expect(r.benchmark.outliers_excluded).toContain('PRJ-H-199');
    });
  });

  it('PLAN-001 → Feasible (Green): all pillars green, no gaps', async () => {
    await withSeededDb(async () => {
      const r = await buildReviewReport({ tenantId: TENANT, planId: 'PLAN-001' });
      expect(r.feasibility_status).toBe('Feasible (Green)');
      expect(r.compliance_score_pct).toBeCloseTo(100, 5);
      expect(r.gap_report).toHaveLength(0);
      expect(r.pillars.every((p) => p.rag === 'Green')).toBe(true);
    });
  });
});
