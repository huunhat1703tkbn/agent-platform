/**
 * Persist a DS07 review report after PMO approval (HITL). State change + domain event
 * commit in one transaction via the core outbox (withEmit → core.emit), per the platform
 * "the bus is the outbox" rule. Emits `pmo.report.issued`.
 */
import { emit, withEmit } from '@seta/core/events';
import { and, desc, eq } from 'drizzle-orm';
import { PMO_REPORT_ISSUED, PMO_REPORT_ISSUED_VERSION } from '../../events.ts';
import { pmoDb } from '../db/client.ts';
import { reviewReport } from '../db/schema.ts';
import { buildReviewReport } from './synthesis.ts';

export interface SaveReviewReportResult {
  report_id: string;
  plan_id: string;
  feasibility_status: string;
  compliance_score_pct: number;
}

/**
 * Build the deterministic DS07 report for a plan and persist it as an issued (approved)
 * review_report row, emitting pmo.report.issued in the same transaction.
 */
export async function saveReviewReport(input: {
  session: { tenant_id: string; user_id: string };
  planId: string;
}): Promise<SaveReviewReportResult> {
  const { tenant_id, user_id } = input.session;
  const report = await buildReviewReport({ tenantId: tenant_id, planId: input.planId });
  const reportId = crypto.randomUUID();

  await withEmit({ actor: { userId: user_id, tenantId: tenant_id } }, async (tx) => {
    await tx.insert(reviewReport).values({
      id: reportId,
      tenant_id,
      plan_id: input.planId,
      status: 'approved', // issued after the HITL approval gate
      compliance_score_pct: report.compliance_score_pct,
      thi_pct: report.thi_pct,
      peak_role_busy_rate_pct: report.peak_role_busy_rate_pct,
      feasibility_status: report.feasibility_status,
      confidence: report.confidence,
      payload: report,
      created_by: user_id,
    });

    await emit({
      tenantId: tenant_id,
      aggregateType: 'pmo.report',
      aggregateId: reportId,
      eventType: PMO_REPORT_ISSUED,
      eventVersion: PMO_REPORT_ISSUED_VERSION,
      payload: {
        actor: { type: 'user' as const, user_id },
        tenant_id,
        report_id: reportId,
        plan_id: input.planId,
        feasibility_status: report.feasibility_status,
        compliance_score_pct: report.compliance_score_pct,
      },
    });
  });

  return {
    report_id: reportId,
    plan_id: input.planId,
    feasibility_status: report.feasibility_status,
    compliance_score_pct: report.compliance_score_pct,
  };
}

/** Read back a persisted review report (most recent first) for verification / display. */
export async function getReviewReports(input: {
  tenantId: string;
  planId: string;
}): Promise<(typeof reviewReport.$inferSelect)[]> {
  return pmoDb()
    .select()
    .from(reviewReport)
    .where(and(eq(reviewReport.tenant_id, input.tenantId), eq(reviewReport.plan_id, input.planId)))
    .orderBy(desc(reviewReport.created_at));
}
