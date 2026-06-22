import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { computeRoleCapacityGap, resetPmoDb, seedPmoDataset } from '../../src/index.ts';

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

describe('computeRoleCapacityGap', () => {
  it('PLAN-002: ML Engineer is the binding constraint, demand exceeds spare headroom', async () => {
    await withSeededDb(async () => {
      const r = await computeRoleCapacityGap({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(r.project_id).toBe('PRJ-002');
      expect(r.roles.length).toBeGreaterThan(0);
      // Every DS03 role maps to a DS08 capacity row (no data-quality gaps).
      expect(r.unmapped_roles).toEqual([]);
      const ml = r.roles.find((x) => x.role === 'ML Engineer');
      expect(ml).toBeDefined();
      expect(ml?.exceeds_spare).toBe(true); // ~42 MD demand vs 13 MD spare
      // The bottleneck role is over the N01 ceiling once the plan is added.
      expect(r.bottleneck?.rag).toBe('Red');
    });
  });

  it('returns an empty assessment for an unknown plan', async () => {
    await withSeededDb(async () => {
      const r = await computeRoleCapacityGap({ tenantId: TENANT, planId: 'PLAN-999' });
      expect(r.project_id).toBeNull();
      expect(r.roles).toEqual([]);
      expect(r.bottleneck).toBeNull();
    });
  });
});
