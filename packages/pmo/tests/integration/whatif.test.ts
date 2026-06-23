import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { recommendHiring, simulateHeadcount } from '../../src/backend/domain/whatif.ts';
import { resetPmoDb, seedPmoDataset } from '../../src/index.ts';

const TENANT = '00000000-0000-0000-0000-0000000000ee';

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

describe('simulateHeadcount (PLAN-002)', () => {
  it('adding ML capacity clears the Resource pillar, but the verdict stays Red (cross-dimension)', async () => {
    await withSeededDb(async () => {
      const r = await simulateHeadcount({
        tenantId: TENANT,
        planId: 'PLAN-002',
        role: 'ML Engineer',
        delta: 2,
      });
      expect(r).not.toBeNull();
      expect(r?.role_found).toBe(true);
      expect(r?.resource_rag_before).toBe('Red');
      expect(r?.resource_rag_after).not.toBe('Red');
      // Hiring does NOT fix the missing Risk Register / dependency cycle.
      expect(r?.feasibility_before).toBe('Not feasible (Red)');
      expect(r?.feasibility_after).toBe('Not feasible (Red)');
      expect(r?.changed).toBe(false);
    });
  });

  it('unknown role returns the available roles to clarify', async () => {
    await withSeededDb(async () => {
      const r = await simulateHeadcount({
        tenantId: TENANT,
        planId: 'PLAN-002',
        role: 'Wizard',
        delta: 1,
      });
      expect(r?.role_found).toBe(false);
      expect(r?.available_roles.length).toBeGreaterThan(0);
    });
  });

  it('unknown plan → null', async () => {
    await withSeededDb(async () => {
      const r = await simulateHeadcount({
        tenantId: TENANT,
        planId: 'PLAN-999',
        role: 'ML Engineer',
        delta: 1,
      });
      expect(r).toBeNull();
    });
  });
});

describe('recommendHiring (PLAN-002)', () => {
  it('recommends hires for the bottleneck and is honest that it does not resolve feasibility', async () => {
    await withSeededDb(async () => {
      const r = await recommendHiring({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(r).not.toBeNull();
      expect(r?.bottleneck?.role).toBe('ML Engineer');
      expect(r?.hires_to_target).toBeGreaterThanOrEqual(1);
      // Risk Register missing + dependency cycle remain Red → hiring alone is not enough.
      expect(r?.resolves_feasibility).toBe(false);
      expect(r?.remaining_blockers.length).toBeGreaterThan(0);
    });
  });
});
