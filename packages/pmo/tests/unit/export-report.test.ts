import type { DomainEvent } from '@seta/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  type ExportReportDeps,
  exportIssuedReport,
  reportS3Key,
} from '../../src/backend/subscribers/export-report.ts';
import type { PmoReportIssuedPayload } from '../../src/events.ts';

const event = {
  id: 'evt-1',
  payload: {
    actor: { type: 'user', user_id: 'u1' },
    tenant_id: 't1',
    report_id: 'rep-1',
    plan_id: 'PLAN-002',
    feasibility_status: 'Not feasible (Red)',
    compliance_score_pct: 71.5,
  },
} as DomainEvent<PmoReportIssuedPayload>;

function deps(over: Partial<ExportReportDeps> = {}): ExportReportDeps {
  return {
    bucket: 'hackathon-team-1-assets',
    loadReport: vi.fn(async () => ({
      payload: { plan_id: 'PLAN-002', feasibility_status: 'Not feasible (Red)' },
      status: 'approved',
      created_at: new Date('2026-06-19T00:00:00Z'),
    })),
    put: vi.fn(async () => {}),
    ...over,
  };
}

describe('exportIssuedReport (pmo.report.issued → S3)', () => {
  it('writes the DS07 report JSON under a deterministic per-report key', async () => {
    const d = deps();
    await exportIssuedReport(event, d);

    expect(d.put).toHaveBeenCalledTimes(1);
    const call = (d.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      bucket: string;
      key: string;
      contentType: string;
      body: string;
    };
    expect(call.bucket).toBe('hackathon-team-1-assets');
    expect(call.key).toBe('processed/ds07/t1/PLAN-002/rep-1.json');
    expect(call.contentType).toBe('application/json');
    const written = JSON.parse(call.body);
    expect(written.report_id).toBe('rep-1');
    expect(written.status).toBe('approved');
    expect(written.report.feasibility_status).toBe('Not feasible (Red)');
  });

  it('no-ops when no bucket is configured (dev/local)', async () => {
    const d = deps({ bucket: undefined });
    await exportIssuedReport(event, d);
    expect(d.put).not.toHaveBeenCalled();
    expect(d.loadReport).not.toHaveBeenCalled();
  });

  it('no-ops when the report row is missing', async () => {
    const d = deps({ loadReport: vi.fn(async () => null) });
    await exportIssuedReport(event, d);
    expect(d.put).not.toHaveBeenCalled();
  });

  it('keys are stable per (tenant, plan, report)', () => {
    expect(reportS3Key({ tenantId: 't1', planId: 'PLAN-002', reportId: 'rep-1' })).toBe(
      'processed/ds07/t1/PLAN-002/rep-1.json',
    );
  });
});
