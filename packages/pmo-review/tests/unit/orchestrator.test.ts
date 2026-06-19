import { InMemoryStore } from '@mastra/core/storage';
import { EMPTY_TRUST, type SpecializedAgentSpec } from '@seta/agent-sdk';
import type { ReviewReport } from '@seta/pmo';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeOrchestratorAgent } from '../../src/backend/orchestration/orchestrator.ts';
import type { PmoReviewPort } from '../../src/backend/orchestration/ports.ts';

const ctx = { tenantId: 't1', actorUserId: 'a1' };

const stub = <I, O>(id: string): SpecializedAgentSpec<I, O> => ({
  id,
  description: '',
  inputSchema: z.any() as z.ZodType<I>,
  outputSchema: z.any() as z.ZodType<O>,
  run: async () => ({ result: {} as O, trust: EMPTY_TRUST }),
});

const noopPort = {} as PmoReviewPort;

function review(planId: string): ReviewReport {
  return {
    plan_id: planId,
    project_id: 'PRJ-1',
    project_name: 'Demo',
    effort_md: null,
    duration_months: null,
    velocity_md_month: null,
    team_size: null,
    risk_count: null,
    thi_pct: 9,
    peak_role_busy_rate_pct: 135,
    on_time_history_pct: null,
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
        plan_velocity_md_month: 0,
        cohort_avg_velocity_md_month: null,
        deviation_pct: null,
        rag: null,
      },
      on_time_history_pct: null,
      on_time_rag: null,
    },
    recommended_adjustments: [],
    audit: { tools_run: [], incomplete_steps: [] },
  };
}

const make = (
  toolResults: { payload: { toolName: string; result: unknown } }[],
  toolCalls: { payload: { toolName: string; args?: unknown } }[] = [],
  text?: string,
) =>
  makeOrchestratorAgent({
    compliance: stub('pmo.compliance'),
    feasibility: stub('pmo.feasibility'),
    benchmark: stub('pmo.benchmark'),
    synthesis: stub('pmo.synthesis'),
    port: noopPort,
    resolveModel: () => ({}) as never,
    mastraStorage: new InMemoryStore(),
    runAgent: async () => ({ toolCalls, toolResults, text }),
  });

describe('pmo-review orchestrator assembly', () => {
  it('full review → { review } with the DS07 verdict + pillar citations', async () => {
    const r = review('PLAN-002');
    const agent = make([{ payload: { toolName: 'pmo_synthesizeReview', result: r } }]);
    const out = await agent.run({ userText: 'review PLAN-002', taskId: null }, ctx);

    expect(out.result.review?.feasibility_status).toBe('Not feasible (Red)');
    expect(out.result.issued).toBeUndefined();
    expect(out.trust.confidenceScore).toBe(0.9);
    expect(out.trust.evidenceCitations.some((c) => c.id === 'PLAN-002')).toBe(true);
  });

  it('issued report (resume turn) → { issued } with the report id', async () => {
    const agent = make(
      [
        {
          payload: {
            toolName: 'pmo_reviewPlan',
            result: { issued: true, reportId: 'rep-9', feasibilityStatus: 'Not feasible (Red)' },
          },
        },
      ],
      [{ payload: { toolName: 'pmo_reviewPlan', args: { planId: 'PLAN-002' } } }],
    );
    const out = await agent.run({ userText: 'issue it', taskId: null }, ctx);

    expect(out.result.issued).toEqual({
      planId: 'PLAN-002',
      reportId: 'rep-9',
      feasibilityStatus: 'Not feasible (Red)',
    });
    expect(out.trust.confidenceScore).toBe(0.95);
  });

  it('describe-project question → { message } from prose, not a review/issue', async () => {
    const agent = make(
      [
        {
          payload: {
            toolName: 'pmo_describePlan',
            result: { planId: 'PLAN-002', projectName: 'Energent AI', taskCount: 10, phases: [] },
          },
        },
      ],
      [{ payload: { toolName: 'pmo_describePlan', args: { planId: 'PLAN-002' } } }],
      'PLAN-002 (Energent AI) is a data-platform project with 10 tasks.',
    );
    const out = await agent.run({ userText: 'describe this project', taskId: null }, ctx);

    expect(out.result.message).toContain('Energent AI');
    expect(out.result.review).toBeUndefined();
    expect(out.result.issued).toBeUndefined();
  });

  it('targeted dimension question → { message } from the LLM prose', async () => {
    const agent = make(
      [
        {
          payload: {
            toolName: 'pmo_checkCompliance',
            result: { planId: 'PLAN-002', score_pct: 71.5 },
          },
        },
      ],
      [{ payload: { toolName: 'pmo_checkCompliance', args: { planId: 'PLAN-002' } } }],
      'PLAN-002 scores 71.5% on compliance.',
    );
    const out = await agent.run({ userText: 'compliance of PLAN-002?', taskId: null }, ctx);

    expect(out.result.message).toBe('PLAN-002 scores 71.5% on compliance.');
    expect(out.result.review).toBeUndefined();
  });

  it('no tools, just a greeting → { message } from the LLM', async () => {
    const agent = make([], [], 'Hi! Which plan should I review?');
    const out = await agent.run({ userText: 'hello', taskId: null }, ctx);
    expect(out.result.message).toBe('Hi! Which plan should I review?');
  });

  it('nothing useful → honest capability message', async () => {
    const agent = make([], [], '');
    const out = await agent.run({ userText: '???', taskId: null }, ctx);
    expect(out.result.message).toMatch(/review a project plan/i);
    expect(out.trust.confidenceScore).toBe(0.3);
  });
});
