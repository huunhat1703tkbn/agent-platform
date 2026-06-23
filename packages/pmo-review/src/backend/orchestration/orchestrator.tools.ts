import {
  defineAgentTool,
  type SpecializedAgentRunCtx,
  type SpecializedAgentSpec,
} from '@seta/agent-sdk';
import type { BenchmarkAssessment, ComplianceResult, ReviewReport } from '@seta/pmo';
import { z } from 'zod';
import { assertPermission } from './permissions.ts';
import { assertKnownPlan } from './plan-guard.ts';
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
      await assertKnownPlan(port, ctx.tenantId, planId);
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
      await assertKnownPlan(port, ctx.tenantId, planId);
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
      await assertKnownPlan(port, ctx.tenantId, planId);
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
      await assertKnownPlan(port, ctx.tenantId, planId);
      const { result } = await synthesis.run({ planId }, subCtx);
      return result;
    },
  });

  const pmo_listPlans = defineAgentTool({
    id: 'pmo_listPlans',
    name: 'List Plans',
    description:
      'List the project plans available to review (id + project name). Use this when the user ' +
      'has not named a plan, or to offer valid options after an unknown plan id.',
    input: z.object({}),
    output: z.object({
      plans: z.array(z.object({ planId: z.string(), projectName: z.string().nullable() })),
    }),
    execute: async () => {
      assertPermission(ctx, 'pmo.plan.read');
      const plans = await port.listPlans({ tenantId: ctx.tenantId });
      return { plans };
    },
  });

  const pmo_describePlan = defineAgentTool({
    id: 'pmo_describePlan',
    name: 'Describe Plan',
    description:
      'Get a descriptive overview of a plan/project — name, type, scope (task count + phases), ' +
      'team size, effort and duration. Use this for "describe this project", "what is PLAN-X", ' +
      '"tell me about this plan". It does NOT compute a feasibility verdict and does NOT issue ' +
      'anything.',
    input: PlanArg,
    output: z.object({
      planId: z.string(),
      projectName: z.string().nullable(),
      projectType: z.string().nullable(),
      planSet: z.string().nullable(),
      effortMd: z.number().nullable(),
      durationMonths: z.number().nullable(),
      velocityMdMonth: z.number().nullable(),
      teamSize: z.number().nullable(),
      riskCount: z.number().nullable(),
      taskCount: z.number(),
      phases: z.array(z.string()),
    }),
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.plan.read');
      await assertKnownPlan(port, ctx.tenantId, planId);
      const o = await port.describePlan({ tenantId: ctx.tenantId, planId });
      if (!o) throw new Error(`Plan "${planId}" not found.`);
      return {
        planId: o.plan_id,
        projectName: o.project_name,
        projectType: o.project_type,
        planSet: o.plan_set,
        effortMd: o.effort_md,
        durationMonths: o.duration_months,
        velocityMdMonth: o.velocity_md_month,
        teamSize: o.team_size,
        riskCount: o.risk_count,
        taskCount: o.task_count,
        phases: o.phases,
      };
    },
  });

  const pmo_simulateHeadcount = defineAgentTool({
    id: 'pmo_simulateHeadcount',
    name: 'Simulate Headcount Change',
    description:
      'What-if: recompute the Resource pillar and DS07 verdict if you add (+N) or remove (−N) ' +
      'people of a role, e.g. "what if we add 2 ML Engineers to PLAN-002". Read-only — it never ' +
      'issues anything. Other dimensions (Risk, dependencies, THI) are held, so the result honestly ' +
      'shows when hiring does NOT make the plan feasible. If the role is unknown, it returns the ' +
      'available roles to pick from.',
    input: z.object({
      planId: z.string().trim().min(1).describe('The plan id, e.g. "PLAN-002".'),
      role: z.string().trim().min(1).describe('The role to change, e.g. "ML Engineer".'),
      delta: z.number().int().describe('People to add (positive) or remove (negative).'),
    }),
    output: z.object({
      planId: z.string(),
      role: z.string(),
      delta: z.number(),
      roleFound: z.boolean(),
      availableRoles: z.array(z.string()),
      resourceRagBefore: z.string().nullable(),
      resourceRagAfter: z.string().nullable(),
      feasibilityBefore: z.string(),
      feasibilityAfter: z.string(),
      changed: z.boolean(),
      note: z.string(),
    }),
    execute: async ({ planId, role, delta }) => {
      assertPermission(ctx, 'pmo.plan.read');
      await assertKnownPlan(port, ctx.tenantId, planId);
      const sim = await port.simulateHeadcount({ tenantId: ctx.tenantId, planId, role, delta });
      if (!sim) throw new Error(`Plan "${planId}" not found.`);
      return {
        planId: sim.plan_id,
        role: sim.role,
        delta: sim.delta,
        roleFound: sim.role_found,
        availableRoles: sim.available_roles,
        resourceRagBefore: sim.resource_rag_before,
        resourceRagAfter: sim.resource_rag_after,
        feasibilityBefore: sim.feasibility_before,
        feasibilityAfter: sim.feasibility_after,
        changed: sim.changed,
        note: sim.note,
      };
    },
  });

  const pmo_recommendHiring = defineAgentTool({
    id: 'pmo_recommendHiring',
    name: 'Recommend Hiring',
    description:
      'Inverse what-if: how many people to hire for the bottleneck role to bring peak busy to ' +
      'target, e.g. "how many people do we need to hire to make PLAN-002 feasible". Honestly reports ' +
      'whether hiring alone resolves the verdict and which non-resource pillars (Risk, dependencies) ' +
      'still block it. Read-only.',
    input: PlanArg,
    output: z.object({
      planId: z.string(),
      role: z.string().nullable(),
      projectedBusyPct: z.number().nullable(),
      headcount: z.number().nullable(),
      hiresToTarget: z.number(),
      targetPct: z.number(),
      feasibilityBefore: z.string(),
      feasibilityAfterHiring: z.string(),
      resolvesFeasibility: z.boolean(),
      remainingBlockers: z.array(z.string()),
      note: z.string(),
    }),
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.plan.read');
      await assertKnownPlan(port, ctx.tenantId, planId);
      const rec = await port.recommendHiring({ tenantId: ctx.tenantId, planId });
      if (!rec) throw new Error(`Plan "${planId}" not found.`);
      return {
        planId: rec.plan_id,
        role: rec.bottleneck?.role ?? null,
        projectedBusyPct: rec.bottleneck?.projected_busy_rate_pct ?? null,
        headcount: rec.headcount,
        hiresToTarget: rec.hires_to_target,
        targetPct: rec.target_pct,
        feasibilityBefore: rec.feasibility_before,
        feasibilityAfterHiring: rec.feasibility_after_hiring,
        resolvesFeasibility: rec.resolves_feasibility,
        remainingBlockers: rec.remaining_blockers,
        note: rec.note,
      };
    },
  });

  const pmo_findSimilarProjects = defineAgentTool({
    id: 'pmo_findSimilarProjects',
    name: 'Find Similar Projects',
    description:
      'Find the historical projects most similar to a plan (by effort, duration, team size and ' +
      'velocity) and report how each one turned out, e.g. "what past projects look like PLAN-002" ' +
      'or "has anything like this been done before". Use it to ground a velocity/feasibility ' +
      'judgement in real outcomes ("resembles PRJ-H-101, which delivered late"). Read-only.',
    input: PlanArg,
    output: z.object({
      planId: z.string(),
      similar: z.array(
        z.object({
          historicalProjectId: z.string(),
          projectType: z.string().nullable(),
          similarityPct: z.number(),
          outcome: z.string().nullable(),
          sameType: z.boolean(),
        }),
      ),
    }),
    execute: async ({ planId }) => {
      assertPermission(ctx, 'pmo.plan.read');
      await assertKnownPlan(port, ctx.tenantId, planId);
      const res = await port.findSimilarProjects({ tenantId: ctx.tenantId, planId });
      if (!res) throw new Error(`Plan "${planId}" not found.`);
      return {
        planId: res.plan_id,
        similar: res.similar.map((s) => ({
          historicalProjectId: s.historical_project_id,
          projectType: s.project_type,
          similarityPct: s.similarity_pct,
          outcome: s.outcome,
          sameType: s.same_type,
        })),
      };
    },
  });

  const pmo_reviewPlan = makeReviewPlanTool({ port, ctx });

  return {
    pmo_listPlans,
    pmo_describePlan,
    pmo_checkCompliance,
    pmo_assessFeasibility,
    pmo_benchmarkVelocity,
    pmo_simulateHeadcount,
    pmo_recommendHiring,
    pmo_findSimilarProjects,
    pmo_synthesizeReview,
    pmo_reviewPlan,
  };
}
