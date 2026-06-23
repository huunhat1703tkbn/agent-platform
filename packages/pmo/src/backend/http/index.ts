import type { SessionEnv } from '@seta/core';
import type { Context, Hono } from 'hono';
import { listPlans } from '../domain/plans.ts';
import { reportToWorkbookBuffer } from '../domain/report-workbook.ts';
import { getReviewReports, saveReviewReport } from '../domain/save-review-report.ts';
import { findSimilarProjects } from '../domain/similarity.ts';
import { buildReviewReport } from '../domain/synthesis.ts';
import { recommendHiring, simulateHeadcount } from '../domain/whatif.ts';

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

  // Historical projects most similar to the plan (deterministic feature similarity) + outcomes.
  app.get('/api/agent/v1/pmo/plans/:planId/similar', async (c) => {
    requirePmoPermission(c, 'pmo.plan.read');
    const scope = c.get('user');
    const planId = c.req.param('planId');
    const result = await findSimilarProjects({ tenantId: scope.tenant_id, planId, k: 5 });
    return c.json(result ?? { plan_id: planId, plan: null, similar: [] });
  });

  // What-if: recompute Resource + verdict under a headcount change (read-only).
  app.get('/api/agent/v1/pmo/plans/:planId/whatif', async (c) => {
    requirePmoPermission(c, 'pmo.plan.read');
    const scope = c.get('user');
    const planId = c.req.param('planId');
    const role = c.req.query('role') ?? '';
    const delta = Number.parseInt(c.req.query('delta') ?? '0', 10) || 0;
    const result = await simulateHeadcount({ tenantId: scope.tenant_id, planId, role, delta });
    if (!result) return c.json({ error: 'plan not found' }, 404);
    return c.json(result);
  });

  // Inverse what-if: hires for the bottleneck role to hit target + honesty about blockers.
  app.get('/api/agent/v1/pmo/plans/:planId/hiring', async (c) => {
    requirePmoPermission(c, 'pmo.plan.read');
    const scope = c.get('user');
    const planId = c.req.param('planId');
    const result = await recommendHiring({ tenantId: scope.tenant_id, planId });
    if (!result) return c.json({ error: 'plan not found' }, 404);
    return c.json(result);
  });

  // Download the DS07 review as an .xlsx workbook (Summary + pillars + gaps + risks +
  // latent risks + recommendations + capacity). Read-only; computed fresh.
  app.get('/api/agent/v1/pmo/plans/:planId/review/download', async (c) => {
    requirePmoPermission(c, 'pmo.plan.read');
    const scope = c.get('user');
    const planId = c.req.param('planId');
    const report = await buildReviewReport({ tenantId: scope.tenant_id, planId });
    const buf = await reportToWorkbookBuffer(report);
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="DS07_Review_${planId}.xlsx"`);
    return c.body(buf as unknown as ArrayBuffer);
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
