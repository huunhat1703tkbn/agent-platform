import type { SpecializedAgentRunCtx } from '@seta/agent-sdk';
import type { ReviewReport, SaveReviewReportResult } from '@seta/pmo';
import { describe, expect, it, vi } from 'vitest';
import type { PmoReviewPort } from '../../src/backend/orchestration/ports.ts';
import { executeReviewPlan } from '../../src/backend/orchestration/review-plan.tool.ts';

function fakeDraft(planId: string): ReviewReport {
  return {
    plan_id: planId,
    project_id: 'PRJ-1',
    project_name: 'Demo',
    effort_md: 100,
    duration_months: 5,
    velocity_md_month: 20,
    team_size: 4,
    risk_count: 0,
    thi_pct: 9,
    peak_role_busy_rate_pct: 135,
    on_time_history_pct: 80,
    compliance_score_pct: 71.5,
    feasibility_status: 'Not feasible (Red)',
    feasibility_reason: 'Not feasible (Red): missing Risk Register',
    confidence: 'high',
    pillars: [{ dimension: 'Risk', rag: 'Red', reason: 'missing Risk Register' }],
    cross_dimension_conflict: null,
    gap_report: [],
    custom_sections: [],
    risk_warnings: [],
    benchmark: {
      plan_id: planId,
      cohort_project_type: 'web',
      similar_projects: [],
      outliers_excluded: [],
      cohort_avg_velocity_md_month: null,
      insufficient_data: false,
      velocity: {
        plan_velocity_md_month: 20,
        cohort_avg_velocity_md_month: null,
        deviation_pct: null,
        rag: null,
      },
      on_time_history_pct: 80,
      on_time_rag: 'Green',
    },
    recommended_adjustments: [],
    risk_score: { score: 0, band: 'Green', drivers: [] },
    latent_risks: [],
    capacity: {
      plan_id: 'PLAN-001',
      project_id: null,
      roles: [],
      bottleneck: null,
      unmapped_roles: [],
    },
    audit: { tools_run: [], incomplete_steps: [] },
  };
}

function makeFakePort(overrides: Partial<PmoReviewPort> = {}): PmoReviewPort {
  return {
    listPlans: vi.fn(async () => [
      { planId: 'PLAN-001', projectName: 'Alpha' },
      { planId: 'PLAN-002', projectName: 'Beta' },
    ]),
    describePlan: vi.fn(async () => null),
    compliance: vi.fn(),
    feasibility: vi.fn(),
    benchmark: vi.fn(),
    synthesis: vi.fn(async ({ planId }) => fakeDraft(planId)),
    simulateHeadcount: vi.fn(async () => null),
    recommendHiring: vi.fn(async () => null),
    findSimilarProjects: vi.fn(async () => null),
    capacityGap: vi.fn(async () => ({
      plan_id: 'PLAN-002',
      project_id: 'PRJ-2',
      roles: [],
      bottleneck: null,
      unmapped_roles: [],
    })),
    issueReport: vi.fn(
      async ({ planId }): Promise<SaveReviewReportResult> => ({
        report_id: 'rep-1',
        plan_id: planId,
        feasibility_status: 'Not feasible (Red)',
        compliance_score_pct: 71.5,
      }),
    ),
    ...overrides,
  };
}

const ctx = (perms: string[]): SpecializedAgentRunCtx => ({
  tenantId: 't1',
  actorUserId: 'u1',
  effectivePermissions: new Set(perms),
});

describe('executeReviewPlan (HITL issue composite)', () => {
  it('first pass: unknown plan → no draft, no suspend, returns the available plans', async () => {
    const port = makeFakePort();
    const suspend = vi.fn();
    const toolCtx = { agent: { suspend, resumeData: undefined } } as never;

    const out = await executeReviewPlan({ planId: 'PLAN-999' }, toolCtx, {
      port,
      ctx: ctx(['pmo.review.read', 'pmo.review.write']),
    });

    expect(out).toEqual({
      issued: false,
      unknownPlan: true,
      availablePlans: ['PLAN-001', 'PLAN-002'],
    });
    expect(port.synthesis).not.toHaveBeenCalled();
    expect(suspend).not.toHaveBeenCalled();
  });

  it('first pass: builds a DS07 draft and suspends with the approval card (no write)', async () => {
    const port = makeFakePort();
    const suspend = vi.fn();
    const toolCtx = { agent: { suspend, resumeData: undefined } } as never;

    const out = await executeReviewPlan({ planId: 'PLAN-002' }, toolCtx, {
      port,
      ctx: ctx(['pmo.review.read', 'pmo.review.write']),
    });

    expect(port.synthesis).toHaveBeenCalledWith({ tenantId: 't1', planId: 'PLAN-002' });
    expect(suspend).toHaveBeenCalledTimes(1);
    const card = (suspend.mock.calls[0]?.[0] as { card: { toolCallId: string; summary: string } })
      .card;
    expect(card.toolCallId).toBe('pmo-review:PLAN-002');
    expect(card.summary).toContain('Not feasible (Red)');
    expect(port.issueReport).not.toHaveBeenCalled();
    expect(out).toEqual({ issued: false });
  });

  it('resume approve: issues the report (pmo.review.write enforced)', async () => {
    const port = makeFakePort();
    const toolCtx = { agent: { resumeData: { decision: 'approve' } } } as never;

    const out = await executeReviewPlan({ planId: 'PLAN-002' }, toolCtx, {
      port,
      ctx: ctx(['pmo.review.read', 'pmo.review.write']),
    });

    expect(port.issueReport).toHaveBeenCalledWith({
      tenantId: 't1',
      actorUserId: 'u1',
      planId: 'PLAN-002',
    });
    expect(out).toEqual({
      issued: true,
      reportId: 'rep-1',
      feasibilityStatus: 'Not feasible (Red)',
    });
  });

  it('resume reject: does not issue', async () => {
    const port = makeFakePort();
    const toolCtx = { agent: { resumeData: { decision: 'reject' } } } as never;

    const out = await executeReviewPlan({ planId: 'PLAN-002' }, toolCtx, {
      port,
      ctx: ctx(['pmo.review.read', 'pmo.review.write']),
    });

    expect(port.issueReport).not.toHaveBeenCalled();
    expect(out).toEqual({ issued: false });
  });

  it('resume approve WITHOUT pmo.review.write is denied', async () => {
    const port = makeFakePort();
    const toolCtx = { agent: { resumeData: { decision: 'approve' } } } as never;

    await expect(
      executeReviewPlan({ planId: 'PLAN-002' }, toolCtx, {
        port,
        ctx: ctx(['pmo.review.read']),
      }),
    ).rejects.toThrow(/pmo\.review\.write/);
    expect(port.issueReport).not.toHaveBeenCalled();
  });
});
