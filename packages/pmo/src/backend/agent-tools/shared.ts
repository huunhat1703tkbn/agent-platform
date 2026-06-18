import type { AgentToolContext } from '@seta/agent-sdk';
import { z } from 'zod';

/** Resolve the caller's tenant from the request context (set by the route layer). */
export function tenantFromCtx(ctx: AgentToolContext): string {
  const tenantId = ctx.requestContext?.get('tenant_id');
  if (!tenantId || typeof tenantId !== 'string') throw new Error('missing tenant_id on request');
  return tenantId;
}

const evidence = z.object({ source: z.literal('DS06'), row_id: z.string() });
const rag = z.enum(['Green', 'Yellow', 'Red']);

export const complianceOutput = z.object({
  score_pct: z.number(),
  risk_register_missing: z.boolean(),
  gaps: z.array(
    z.object({
      check_id: z.string(),
      component_id: z.string(),
      section_code: z.string().nullable(),
      component_name: z.string().nullable(),
      status: z.enum(['Weak', 'Missing']),
      severity: z.enum(['High', 'Medium', 'Low']),
      weight: z.number(),
      custom_name: z.null(),
      note: z.string().nullable(),
      evidence,
    }),
  ),
  custom_sections: z.array(
    z.object({
      name: z.string(),
      action: z.literal('flag_for_pmo_review'),
      evidence,
      note: z.string().nullable(),
    }),
  ),
});

export const dependencyOutput = z.object({
  has_cycle: z.boolean(),
  cycles: z.array(z.array(z.string())),
  order_violations: z.array(
    z.object({
      task_id: z.string(),
      depends_on: z.string(),
      task_phase: z.string().nullable(),
      dependency_phase: z.string().nullable(),
    }),
  ),
  dangling: z.array(z.object({ task_id: z.string(), missing_dependency: z.string() })),
});

export const busyRateOutput = z.object({
  plan_id: z.string(),
  project_id: z.string().nullable(),
  peak_role_busy_rate_pct: z.number().nullable(),
  peak_rag: rag.nullable(),
  members: z.array(
    z.object({
      member_id: z.string(),
      role: z.string().nullable(),
      busy_rate_pct: z.number(),
      rag,
    }),
  ),
  max_member_rag: rag.nullable(),
});

export const thiOutput = z.object({
  plan_id: z.string(),
  thi_pct: z.number().nullable(),
  rag: rag.nullable(),
});
