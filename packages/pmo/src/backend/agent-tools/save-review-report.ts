import { actorFromContext, defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { saveReviewReport } from '../domain/save-review-report.ts';
import { tenantFromCtx } from './shared.ts';

export const pmoSaveReviewReportTool = defineAgentTool({
  id: 'pmo_saveReviewReport',
  name: 'Issue DS07 Review Report',
  description:
    'Build the deterministic DS07 review report for a plan (compliance, feasibility, benchmark, ' +
    'synthesis) and persist it as the issued report. Requires PMO approval before it is written. ' +
    'Emits pmo.report.issued.',
  input: z.object({
    planId: z.string().trim().min(1).describe('The plan id to issue a review report for.'),
  }),
  output: z.object({
    report_id: z.string(),
    plan_id: z.string(),
    feasibility_status: z.string(),
    compliance_score_pct: z.number(),
  }),
  rbac: 'pmo.review.write',
  needsApproval: true,
  execute: async (input, ctx) => {
    const actor = actorFromContext(ctx);
    return saveReviewReport({
      session: { tenant_id: tenantFromCtx(ctx), user_id: actor.user_id },
      planId: input.planId,
    });
  },
});
