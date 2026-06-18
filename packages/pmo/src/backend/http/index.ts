import type { SessionEnv } from '@seta/core';
import type { Context, Hono } from 'hono';
import { listPlans } from '../domain/plans.ts';
import { getReviewReports, saveReviewReport } from '../domain/save-review-report.ts';
import { buildReviewReport } from '../domain/synthesis.ts';

/** 403 unless the caller holds the given pmo permission (org/tenant admin resolve to all). */
function requirePmoPermission(c: Context<SessionEnv>, permission: string): void {
  const scope = c.get('user');
  if (!scope.permissions.has(permission)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
}

export function registerPmoRoutes(app: Hono<SessionEnv>): void {
  // List the plans available for review (the DS07 picker).
  app.get('/api/agent/v1/pmo/plans', async (c) => {
    requirePmoPermission(c, 'pmo.plan.read');
    const scope = c.get('user');
    const plans = await listPlans({ tenantId: scope.tenant_id });
    return c.json({ plans });
  });

  // Compute (read-only) the deterministic DS07 review report for a plan, plus the
  // status of any already-issued report.
  app.get('/api/agent/v1/pmo/plans/:planId/review', async (c) => {
    requirePmoPermission(c, 'pmo.plan.read');
    const scope = c.get('user');
    const planId = c.req.param('planId');
    const [report, issued] = await Promise.all([
      buildReviewReport({ tenantId: scope.tenant_id, planId }),
      getReviewReports({ tenantId: scope.tenant_id, planId }),
    ]);
    return c.json({ report, issued: issued[0] ?? null });
  });

  // Issue (persist) the DS07 report — the PMO approval action. Emits pmo.report.issued.
  app.post('/api/agent/v1/pmo/plans/:planId/review', async (c) => {
    requirePmoPermission(c, 'pmo.review.write');
    const scope = c.get('user');
    const planId = c.req.param('planId');
    const result = await saveReviewReport({
      session: { tenant_id: scope.tenant_id, user_id: scope.user_id },
      planId,
    });
    return c.json(result);
  });
}
