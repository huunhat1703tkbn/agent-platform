import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { findSimilarProjects } from '../../src/backend/domain/similarity.ts';
import { resetPmoDb, seedPmoDataset } from '../../src/index.ts';

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

describe('findSimilarProjects (PLAN-002 vs DS05 history)', () => {
  it('returns the top-k most similar past projects with their outcomes', async () => {
    await withSeededDb(async () => {
      const r = await findSimilarProjects({ tenantId: TENANT, planId: 'PLAN-002', k: 3 });
      expect(r).not.toBeNull();
      expect(r?.similar.length).toBeGreaterThan(0);
      expect(r?.similar.length).toBeLessThanOrEqual(3);

      const top = r?.similar[0];
      expect(top?.similarity_pct).toBeGreaterThan(0);
      expect(top?.similarity_pct).toBeLessThanOrEqual(100);
      // Outcomes are carried through for the "how did it end up" narration.
      expect(top?.outcome).toBeTruthy();
      // Sorted descending by similarity.
      const pcts = r?.similar.map((s) => s.similarity_pct) ?? [];
      expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    });
  });

  it('returns null for an unknown plan', async () => {
    await withSeededDb(async () => {
      const r = await findSimilarProjects({ tenantId: TENANT, planId: 'PLAN-999' });
      expect(r).toBeNull();
    });
  });
});
