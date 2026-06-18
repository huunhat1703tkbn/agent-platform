import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { validateDependencies } from '../domain/dependencies.ts';
import { dependencyOutput, tenantFromCtx } from './shared.ts';

export const pmoDependencyValidatorTool = defineAgentTool({
  id: 'pmo_dependencyValidator',
  name: 'Validate Dependencies',
  description:
    "Validate a project's task dependency graph (DS01): detect dependency cycles, phase-order " +
    'violations (a prerequisite from a strictly later phase, e.g. deploy-before-test), and dangling ' +
    'references to unknown tasks. Any cycle is a Red dependency risk. Read-only.',
  input: z.object({
    projectId: z
      .string()
      .trim()
      .min(1)
      .describe('The project id whose plan tasks to check, e.g. "PRJ-002".'),
  }),
  output: dependencyOutput,
  rbac: 'pmo.plan.read',
  execute: async (input, ctx) =>
    validateDependencies({ tenantId: tenantFromCtx(ctx), projectId: input.projectId }),
});
