import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import {
  computeOnTimeHistory,
  computePlanVelocity,
  computeScheduleRealism,
  resetPmoDb,
  seedPmoDataset,
} from '../../src/index.ts';

const TENANT = '00000000-0000-0000-0000-00000000a001';

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

describe('computePlanVelocity (duration derived from the DS01 schedule, not the DS07 header)', () => {
  it('PLAN-002: effort 426 (Σ DS01), duration = span(max−min) ÷ 30 ≈ 7.13 mo ⇒ velocity ≈ 59.7', async () => {
    await withSeededDb(async () => {
      const v = await computePlanVelocity({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(v.effort_md).toBe(426);
      // 2026-04-06 → 2026-11-06 = 214 days (max − min) = 214/30 months.
      expect(v.duration_months).toBeCloseTo(214 / 30, 5);
      expect(v.velocity_md_month).toBeCloseTo(59.7, 0);
    });
  });

  it('PLAN-001 baseline: effort 168, duration = 185/30 ≈ 6.17 mo ⇒ velocity ≈ 27.2', async () => {
    await withSeededDb(async () => {
      const v = await computePlanVelocity({ tenantId: TENANT, planId: 'PLAN-001' });
      expect(v.effort_md).toBe(168);
      // 2026-05-19 → 2026-11-20 = 185 days (max − min) = 185/30 months.
      expect(v.duration_months).toBeCloseTo(185 / 30, 5);
      expect(v.velocity_md_month).toBeCloseTo(27.2, 0);
    });
  });

  it('returns zero effort / null duration + velocity for an unknown plan', async () => {
    await withSeededDb(async () => {
      const v = await computePlanVelocity({ tenantId: TENANT, planId: 'PLAN-999' });
      expect(v.effort_md).toBe(0);
      expect(v.duration_months).toBeNull();
      expect(v.velocity_md_month).toBeNull();
    });
  });
});

describe('computeScheduleRealism (timeline-realism signal)', () => {
  it('PLAN-104: task schedule span exceeds the planned 5-month duration', async () => {
    await withSeededDb(async () => {
      const r = await computeScheduleRealism({ tenantId: TENANT, planId: 'PLAN-104' });
      expect(r.planned_duration_months).toBe(5);
      expect(r.schedule_span_months).toBeGreaterThan(5);
      expect(r.span_exceeds_planned).toBe(true);
      expect(r.over_run_pct).toBeGreaterThan(0);
    });
  });

  it('PLAN-002: tasks fit inside the planned 9-month duration (no overrun flag)', async () => {
    await withSeededDb(async () => {
      const r = await computeScheduleRealism({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(r.span_exceeds_planned).toBe(false);
    });
  });
});

describe('computeOnTimeHistory (cohort schedule-adherence N07 signal)', () => {
  it('PLAN-002 (AI/ML Platform): mean schedule adherence ≈ 94.3% (DS07 header 90)', async () => {
    await withSeededDb(async () => {
      const r = await computeOnTimeHistory({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(r.cohort_project_type).toBe('AI/ML Platform');
      // Cohort excludes the tiny AI/ML outlier; H-103 (255/270) + H-104 (240/255):
      // mean(min(1, planned/actual)) = (0.9444 + 0.9412)/2 ≈ 0.9428 → 94.3%.
      expect(r.on_time_history_pct).toBeCloseTo(94.3, 1);
      expect(r.rag).toBe('Green'); // ≥ 90
    });
  });

  it('flags insufficient_data when the cohort is below the minimum size', async () => {
    await withSeededDb(async () => {
      const r = await computeOnTimeHistory({ tenantId: TENANT, planId: 'PLAN-002' }, 99);
      expect(r.insufficient_data).toBe(true);
    });
  });
});
