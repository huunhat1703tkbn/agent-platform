import {
  type AgentToolContext,
  defineAgentTool,
  type SpecializedAgentRunCtx,
} from '@seta/agent-sdk';
import { z } from 'zod';
import { buildReviewApprovalCard } from './approval-card.ts';
import { assertPermission } from './permissions.ts';
import type { PmoReviewPort } from './ports.ts';

export interface ReviewPlanDeps {
  port: PmoReviewPort;
  /** The orchestrator's run ctx: tenant/actor/permissions/abort. */
  ctx: SpecializedAgentRunCtx;
}

const InputSchema = z.object({
  planId: z
    .string()
    .trim()
    .min(1)
    .describe('The plan id to review and (on approval) issue, e.g. "PLAN-002".'),
});

const OutputSchema = z.object({
  issued: z.boolean(),
  reportId: z.string().optional(),
  feasibilityStatus: z.string().optional(),
});

const SuspendSchema = z.object({ card: z.unknown() });

const ResumeSchema = z.object({
  decision: z.enum(['approve', 'reject', 'modify']),
  note: z.string().optional(),
});

type Resume = z.infer<typeof ResumeSchema>;
type Output = z.infer<typeof OutputSchema>;

/**
 * The review → approve → issue composite. First pass: build the deterministic
 * DS07 draft and suspend with the approval card (the PMO checkpoint). On resume:
 * approve/modify issues the report (pmo.review.write re-checked at the callee);
 * reject leaves the plan unissued.
 *
 * Stateless across resume by design: resume may run in a DIFFERENT process (page
 * reload). The decision comes ONLY from `ctx.agent.resumeData`; the report is
 * rebuilt deterministically from the plan id on issue.
 *
 * Extracted from the tool factory so the suspend/resume branches are unit-
 * testable without a live Mastra agent or circuit breaker.
 */
export async function executeReviewPlan(
  input: { planId: string },
  toolCtx: AgentToolContext<{ card: unknown }, Resume>,
  deps: ReviewPlanDeps,
): Promise<Output> {
  const { port, ctx } = deps;
  const agent = toolCtx.agent;
  const resume = agent?.resumeData;

  // ── Resume pass: short-circuit. No draft rebuild for the card. ──
  if (resume) {
    if (resume.decision === 'reject') return { issued: false };
    assertPermission(ctx, 'pmo.review.write');
    const saved = await port.issueReport({
      tenantId: ctx.tenantId,
      actorUserId: ctx.actorUserId,
      planId: input.planId,
    });
    return {
      issued: true,
      reportId: saved.report_id,
      feasibilityStatus: saved.feasibility_status,
    };
  }

  // ── First pass: build the DS07 draft, suspend with the approval card. ──
  assertPermission(ctx, 'pmo.review.read');
  const draft = await port.synthesis({ tenantId: ctx.tenantId, planId: input.planId });
  const card = buildReviewApprovalCard({
    draft,
    tenantId: ctx.tenantId,
    userId: ctx.actorUserId,
  });
  if (typeof agent?.suspend === 'function') {
    // Mastra unwinds (throws) at suspend() on the suspending pass — nothing past
    // it runs. The return below types the tool and covers the test-fake path.
    await agent.suspend({ card });
  }
  return { issued: false };
}

/**
 * The HITL issue composite as an agent tool. The orchestrator calls this to
 * review a plan and ask the PMO to confirm issuing the DS07 report.
 */
export function makeReviewPlanTool(deps: ReviewPlanDeps) {
  return defineAgentTool({
    id: 'pmo_reviewPlan',
    name: 'Review Plan & Issue DS07',
    description: [
      'Build the DS07 review (compliance, feasibility, benchmark, synthesis) for a plan and',
      'ask the PMO to confirm issuing it. Pass the plan id (e.g. "PLAN-002"). It runs the',
      'deterministic engine and pauses for approval before writing the report — issuing is',
      'NEVER a direct write you perform; it ALWAYS goes through this confirmation gate.',
    ].join('\n'),
    input: InputSchema,
    output: OutputSchema,
    suspendSchema: SuspendSchema,
    resumeSchema: ResumeSchema,
    execute: (input, toolCtx) => executeReviewPlan(input, toolCtx, deps),
  });
}
