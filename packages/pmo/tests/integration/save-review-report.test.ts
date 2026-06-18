import { resetCoreDb } from '@seta/core/testing';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { getReviewReports, resetPmoDb, saveReviewReport, seedPmoDataset } from '../../src/index.ts';

const TENANT = '00000000-0000-0000-0000-0000000000ee';
const USER = '00000000-0000-0000-0000-0000000000ff';

async function withSeededDb(
  fn: (pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  }) => Promise<void>,
): Promise<void> {
  await withTestDb(
    {
      templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
      baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
    },
    async ({ pool, databaseUrl }) => {
      resetPmoDb();
      resetCoreDb();
      initPools({ databaseUrl });
      try {
        await seedPmoDataset({ tenantId: TENANT });
        await fn(pool as never);
      } finally {
        resetPmoDb();
        resetCoreDb();
        await closePools();
      }
    },
  );
}

describe('saveReviewReport (HITL write + outbox event)', () => {
  it('persists an approved review_report row and emits pmo.report.issued in one transaction', async () => {
    await withSeededDb(async (pool) => {
      const result = await saveReviewReport({
        session: { tenant_id: TENANT, user_id: USER },
        planId: 'PLAN-002',
      });

      expect(result.feasibility_status).toBe('Not feasible (Red)');
      expect(result.report_id).toMatch(/[0-9a-f-]{36}/);

      // Row persisted with the issued status + denormalised header metrics.
      const saved = await getReviewReports({ tenantId: TENANT, planId: 'PLAN-002' });
      expect(saved).toHaveLength(1);
      expect(saved[0]?.status).toBe('approved');
      expect(saved[0]?.created_by).toBe(USER);
      expect(saved[0]?.feasibility_status).toBe('Not feasible (Red)');

      // Event written to the core outbox in the same commit.
      const events = await pool.query(
        `SELECT event_type, aggregate_id, payload FROM core.events
         WHERE tenant_id = $1 AND event_type = 'pmo.report.issued'`,
        [TENANT],
      );
      expect(events.rows).toHaveLength(1);
      const row = events.rows[0] as { aggregate_id: string; payload: { plan_id: string } };
      expect(row.aggregate_id).toBe(result.report_id);
      expect(row.payload.plan_id).toBe('PLAN-002');
    });
  });
});
