import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { assessBusyRate } from '../domain/feasibility.ts';
import { busyRateOutput, tenantFromCtx } from './shared.ts';

export const pmoBusyRateCalcTool = defineAgentTool({
  id: 'pmo_busyRateCalc',
  name: 'Calculate Busy Rate',
  description:
    'Assess resource feasibility (N01 Busy Rate) for a plan: per-member busy rate computed from DS03 ' +
    'and the role-level peak (DS07), each classified Green/Yellow/Red. >120% or <75% is Red. Read-only.',
  input: z.object({
    planId: z.string().trim().min(1).describe('The plan id under review, e.g. "PLAN-002".'),
  }),
  output: busyRateOutput,
  rbac: 'pmo.plan.read',
  execute: async (input, ctx) =>
    assessBusyRate({ tenantId: tenantFromCtx(ctx), planId: input.planId }),
});
