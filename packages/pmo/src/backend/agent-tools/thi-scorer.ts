import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { assessThi } from '../domain/feasibility.ts';
import { tenantFromCtx, thiOutput } from './shared.ts';

export const pmoThiScorerTool = defineAgentTool({
  id: 'pmo_thiScorer',
  name: 'Score Tech Health Index',
  description:
    'Score the Technical Health Index (N10 THI = non-dev hours / total hours) for a plan and classify ' +
    'it Green/Yellow/Red. Green 15–25%; <10% or >35% is Red (too little/too much non-dev budget). Read-only.',
  input: z.object({
    planId: z.string().trim().min(1).describe('The plan id under review, e.g. "PLAN-002".'),
  }),
  output: thiOutput,
  rbac: 'pmo.plan.read',
  execute: async (input, ctx) => assessThi({ tenantId: tenantFromCtx(ctx), planId: input.planId }),
});
