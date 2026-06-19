import {
  defineAgentTool,
  type SpecializedAgentRunCtx,
  type SpecializedAgentSpec,
} from '@seta/agent-sdk';
import type { BenchmarkAssessment, ComplianceResult, ReviewReport } from '@seta/pmo';
import { z } from 'zod';
import { assertPermission } from './permissions.ts';
import type { PmoReviewPort } from './ports.ts';
import { makeReviewPlanTool } from './review-plan.tool.ts';
import { type FeasibilityFindings, SynthesisOutputSchema } from './schemas.ts';

type ComplianceSpec = SpecializedAgentSpec<{ planId: string }, ComplianceResult>;
type FeasibilitySpec = SpecializedAgentSpec<{ planId: string }, FeasibilityFindings>;
type BenchmarkSpec = SpecializedAgentSpec<{ planId: string }, BenchmarkAssessment>;
type SynthesisSpec = SpecializedAgentSpec<{ planId: string }, ReviewReport>;

export interface OrchestratorToolDeps {
  compliance: ComplianceSpec;
  feasibility: FeasibilitySpec;
  benchmark: BenchmarkSpec;
  synthesis: SynthesisSpec;
  port: PmoReviewPort;
  ctx: SpecializedAgentRunCtx;
}

const PlanArg = z.object({
  planId: z.string().trim().min(1).describe('The plan id under review, e.g. "PLAN-002".'),
});

/**
 * The orchestrator's sub-agent delegation tools. Each read tool runs a
 * specialist deterministic sub-agent (via direct .run, not the registry) under
 * the same tenant/actor; the issue composite suspends for the PMO approval gate.
 */
export function makeOrchestratorTools(deps: OrchestratorToolDeps) {
  const { compliance, feasibility, benchmark, synthesis, port, ctx } = deps;

  // Sub-agents run with the same tenant/actor/permissions; the per-turn model
  // override rides along so any future LLM sub-step honors the user's pick.
  const subCtx: SpecializedAgentRunCtx = {
    tenantId: ctx.tenantId,
    actorUserId: ctx.actorUserId,
    effectivePermissions: ctx.effectivePermissions,
    abortSignal: ctx.abortSignal,
    model: ctx.model,
  };

  const pmo_checkCompliance = defineAgentTool({
    id: 'pmo_checkCompliance',
    name: 'Check Compliance',
    description:
      'Score a plan against the PMO standard template: weighted compliance %, section gaps ' +
      '(Weak/Missing), custom sections flagged for review, and whether the Risk Register is missing.',
    input: PlanArg,
    output: z.object({
      planId: z.string(),
      score_pct: z.number(),
      risk_register_missing: z.boolean(),
      gap_count: z.number(),
      custom_section_count: z.number(),
    }),
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.plan.read');
      const { result } = await compliance.run({ planId }, subCtx);
      return {
        planId,
        score_pct: result.score_pct,
        risk_register_missing: result.risk_register_missing,
        gap_count: result.gaps.length,
        custom_section_count: result.custom_sections.length,
      };
    },
  });

  const pmo_assessFeasibility = defineAgentTool({
    id: 'pmo_assessFeasibility',
    name: 'Assess Feasibility',
    description:
      'Assess resource overload (peak/member busy rate), Talent Health Index (THI), and ' +
      'dependency/timeline risks (cycles + phase-order violations) for a plan.',
    input: PlanArg,
    output: z.object({
      planId: z.string(),
      peak_busy_rate_pct: z.number().nullable(),
      peak_rag: z.string().nullable(),
      thi_pct: z.number().nullable(),
      thi_rag: z.string().nullable(),
      has_cycle: z.boolean(),
      order_violation_count: z.number(),
    }),
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.plan.read');
      const { result } = await feasibility.run({ planId }, subCtx);
      return {
        planId,
        peak_busy_rate_pct: result.busy.peak_role_busy_rate_pct,
        peak_rag: result.busy.peak_rag,
        thi_pct: result.thi.thi_pct,
        thi_rag: result.thi.rag,
        has_cycle: result.deps.has_cycle,
        order_violation_count: result.deps.order_violations.length,
      };
    },
  });

  const pmo_benchmarkVelocity = defineAgentTool({
    id: 'pmo_benchmarkVelocity',
    name: 'Benchmark Velocity',
    description:
      'Compare the plan velocity against similar historical projects (cohort by type, outliers ' +
      'excluded). Reports velocity RAG, on-time history, and whether the cohort is too small.',
    input: PlanArg,
    output: z.object({
      planId: z.string(),
      cohort_size: z.number(),
      outliers_excluded: z.array(z.string()),
      velocity_rag: z.string().nullable(),
      on_time_history_pct: z.number().nullable(),
      insufficient_data: z.boolean(),
    }),
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.plan.read');
      const { result } = await benchmark.run({ planId }, subCtx);
      return {
        planId,
        cohort_size: result.similar_projects.length,
        outliers_excluded: result.outliers_excluded,
        velocity_rag: result.velocity.rag,
        on_time_history_pct: result.on_time_history_pct,
        insufficient_data: result.insufficient_data,
      };
    },
  });

  const pmo_synthesizeReview = defineAgentTool({
    id: 'pmo_synthesizeReview',
    name: 'Synthesize DS07 Review',
    description:
      'Roll up ALL dimensions into the DS07 verdict: feasibility status, the cross-dimension ' +
      'conflict (a plan can pass compliance yet be infeasible), risk warnings, and recommended ' +
      'adjustments. Call this for a full plan review — it composes compliance, feasibility, and ' +
      'benchmark itself, so you do not need to call those separately first.',
    input: PlanArg,
    output: SynthesisOutputSchema,
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.review.read');
      const { result } = await synthesis.run({ planId }, subCtx);
      return result;
    },
  });

  const pmo_reviewPlan = makeReviewPlanTool({ port, ctx });

  return {
    pmo_checkCompliance,
    pmo_assessFeasibility,
    pmo_benchmarkVelocity,
    pmo_synthesizeReview,
    pmo_reviewPlan,
  };
}
