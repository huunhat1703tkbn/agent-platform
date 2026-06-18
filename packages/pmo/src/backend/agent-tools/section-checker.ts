import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { scoreCompliance } from '../domain/compliance.ts';
import { complianceOutput, tenantFromCtx } from './shared.ts';

export const pmoSectionCheckerTool = defineAgentTool({
  id: 'pmo_sectionChecker',
  name: 'Check Plan Sections',
  description:
    'Score a project plan against the PMO standard template (DS02 × DS06): weighted compliance %, ' +
    'section gaps (Weak/Missing with severity + evidence), custom sections flagged for review, and ' +
    'whether the Risk Register (S07) is missing (which defaults the Risk pillar to Red). Read-only.',
  input: z.object({
    planId: z.string().trim().min(1).describe('The plan id under review, e.g. "PLAN-002".'),
  }),
  output: complianceOutput,
  rbac: 'pmo.plan.read',
  execute: async (input, ctx) =>
    scoreCompliance({ tenantId: tenantFromCtx(ctx), planId: input.planId }),
});
