/**
 * Downstream of `pmo.report.issued`: export the issued DS07 report to the team's
 * own S3 bucket (`s3://<bucket>/processed/ds07/<tenant>/<plan>/<report>.json`).
 *
 * Closes the hackathon S3 round-trip: the shared dataset is read from the
 * organizer bucket (seed), processed by ProjectPlanGuard, and the result is
 * written back to the team bucket. Idempotent: the S3 key is deterministic per
 * report id, so at-least-once redelivery overwrites the same object.
 *
 * No-ops when PMO_REPORT_S3_BUCKET is unset (dev/local), so the chat HITL flow
 * works without S3. On EC2 the worker writes via the instance role (no keys).
 */
import { putObject } from '@seta/shared-storage';
import type { DomainEvent, SubscriberDef } from '@seta/shared-types';
import { eq } from 'drizzle-orm';
import type { PmoReportIssuedPayload } from '../../events.ts';
import { pmoDb } from '../db/client.ts';
import { reviewReport } from '../db/schema.ts';

export interface ExportReportDeps {
  /** Destination bucket; undefined disables export (no-op). */
  bucket: string | undefined;
  loadReport: (
    reportId: string,
  ) => Promise<{ payload: unknown; status: string; created_at: Date } | null>;
  put: (input: { bucket: string; key: string; body: string; contentType: string }) => Promise<void>;
}

/** Deterministic per-report object key (idempotent overwrite on redelivery). */
export function reportS3Key(p: { tenantId: string; planId: string; reportId: string }): string {
  return `processed/ds07/${p.tenantId}/${p.planId}/${p.reportId}.json`;
}

export async function exportIssuedReport(
  event: DomainEvent<PmoReportIssuedPayload>,
  deps: ExportReportDeps,
): Promise<void> {
  if (!deps.bucket) return; // not configured (dev/local) → no-op
  const { report_id, plan_id, tenant_id, feasibility_status, compliance_score_pct } = event.payload;

  const row = await deps.loadReport(report_id);
  if (!row) return; // report row gone — nothing to export

  const key = reportS3Key({ tenantId: tenant_id, planId: plan_id, reportId: report_id });
  const body = JSON.stringify(
    {
      report_id,
      plan_id,
      tenant_id,
      status: row.status,
      feasibility_status,
      compliance_score_pct,
      issued_at: row.created_at,
      report: row.payload,
    },
    null,
    2,
  );

  await deps.put({ bucket: deps.bucket, key, body, contentType: 'application/json' });
}

async function loadReportRow(
  reportId: string,
): Promise<{ payload: unknown; status: string; created_at: Date } | null> {
  const [row] = await pmoDb()
    .select({
      payload: reviewReport.payload,
      status: reviewReport.status,
      created_at: reviewReport.created_at,
    })
    .from(reviewReport)
    .where(eq(reviewReport.id, reportId))
    .limit(1);
  return row ?? null;
}

/** SubscriberDef handler bound to the real db read + shared-storage putObject. */
export const exportIssuedReportHandler: SubscriberDef<PmoReportIssuedPayload>['handler'] = (
  event,
) =>
  exportIssuedReport(event, {
    bucket: process.env.PMO_REPORT_S3_BUCKET?.trim() || undefined,
    loadReport: loadReportRow,
    put: putObject,
  });
