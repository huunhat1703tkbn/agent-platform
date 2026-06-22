import { buildReviewReport } from '@seta/pmo';
import { closePools } from '@seta/shared-db';
import type { Command } from 'commander';
import { resolveTenantId } from './lib/tenant-resolve.ts';

/**
 * Observe the deterministic DS07 review DRAFT for a plan: runs the full engine
 * (compliance + feasibility + benchmark + synthesis roll-up) via buildReviewReport
 * and prints the computed object to stdout. Read-only — nothing is issued or
 * persisted (no review_report row, no pmo.report.issued event, no S3 export).
 */
export function registerPmoReviewCommand(program: Command): void {
  program
    .command('pmo-review')
    .description(
      'Compute and print the DS07 review draft for a plan (read-only; nothing is issued)',
    )
    .requiredOption('--plan <planId>', 'Plan id to review, e.g. PLAN-002')
    .option('--tenant <slugOrId>', 'Tenant slug or id', 'hackathon')
    .action(async (opts: { plan: string; tenant: string }) => {
      try {
        const tenantId = await resolveTenantId(opts.tenant);
        const report = await buildReviewReport({ tenantId, planId: opts.plan });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } finally {
        await closePools();
      }
    });
}
