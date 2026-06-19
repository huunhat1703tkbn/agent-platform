import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { getPlanOverview, listPlans, resetPmoDb, seedPmoDataset } from '../../src/index.ts';

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

describe('listPlans', () => {
  it('returns the seeded plans under review with project metadata', async () => {
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
          const plans = await listPlans({ tenantId: TENANT });
          const ids = plans.map((p) => p.plan_id);
          expect(ids).toContain('PLAN-001');
          expect(ids).toContain('PLAN-002');
          const p002 = plans.find((p) => p.plan_id === 'PLAN-002');
          expect(p002?.project_name).toContain('Energent');
        } finally {
          resetPmoDb();
          await closePools();
        }
      },
    );
  });
});

describe('getPlanOverview', () => {
  it('returns a project overview (metrics + scope) for a known plan', async () => {
    await withSeededDb(async () => {
      const o = await getPlanOverview({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(o).not.toBeNull();
      expect(o?.project_name).toContain('Energent');
      expect(o?.task_count).toBe(10);
      expect(o?.phases).toEqual(expect.arrayContaining(['Design', 'Development', 'Testing']));
      expect(o?.team_size).toBeGreaterThan(0);
      expect(o?.duration_months).toBeGreaterThan(0);
    });
  });

  it('returns null for an unknown plan', async () => {
    await withSeededDb(async () => {
      expect(await getPlanOverview({ tenantId: TENANT, planId: 'PLAN-999' })).toBeNull();
    });
  });
});
