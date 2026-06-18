import { seedPmoDataset } from '@seta/pmo';
import { closePools } from '@seta/shared-db';
import type { Command } from 'commander';
import pino from 'pino';
import { resolveTenantId } from './lib/tenant-resolve.ts';

const log = pino({ name: 'cli/pmo-seed' });

/**
 * Load the PMO-01 mock dataset (DS01–DS08 + REF + KPI norms) into the `pmo`
 * schema for a tenant. Idempotent: delete-then-insert per tenant.
 */
export function registerPmoSeedCommand(program: Command): void {
  program
    .command('pmo-seed')
    .description('Load the PMO-01 ProjectPlanGuard dataset into the pmo schema for a tenant')
    .option('--tenant <slugOrId>', 'Tenant slug or id', 'hackathon')
    .action(async (opts: { tenant: string }) => {
      try {
        const tenantId = await resolveTenantId(opts.tenant);
        const { counts } = await seedPmoDataset({ tenantId });
        log.info({ tenantId, tenant: opts.tenant, counts }, 'pmo dataset seeded');
      } finally {
        await closePools();
      }
    });
}
