/**
 * The PmoReviewPort implementation, bound to the @seta/pmo public surface.
 * Reads call the deterministic domain functions directly (the chat route gates
 * entry; the orchestrator re-checks pmo.* permissions before delegating). The
 * single write goes through saveReviewReport, which re-checks pmo.review.write
 * at the pmo callee and commits the report + outbox event in one transaction.
 */
import {
  assessBenchmark,
  assessBusyRate,
  assessThi,
  buildReviewReport,
  computeRoleCapacityGap,
  type DependencyResult,
  findSimilarProjects,
  getPlanOverview,
  listPlans,
  recommendHiring,
  saveReviewReport,
  scoreCompliance,
  simulateHeadcount,
  validateDependencies,
} from '@seta/pmo';
import type { PmoReviewPort } from './ports.ts';

const NO_DEPS: DependencyResult = {
  has_cycle: false,
  cycles: [],
  order_violations: [],
  dangling: [],
};

export function makePmoReviewPort(): PmoReviewPort {
  return {
    async listPlans({ tenantId }) {
      const plans = await listPlans({ tenantId });
      return plans.map((p) => ({ planId: p.plan_id, projectName: p.project_name }));
    },

    describePlan: ({ tenantId, planId }) => getPlanOverview({ tenantId, planId }),

    compliance: ({ tenantId, planId }) => scoreCompliance({ tenantId, planId }),

    async feasibility({ tenantId, planId }) {
      // busy + thi key off the plan; dependency validation needs the project id,
      // resolved from the DS07 summary listing (no cross-schema FK exists).
      const [busy, thi, plans] = await Promise.all([
        assessBusyRate({ tenantId, planId }),
        assessThi({ tenantId, planId }),
        listPlans({ tenantId }),
      ]);
      const projectId = plans.find((p) => p.plan_id === planId)?.project_id ?? null;
      const deps = projectId ? await validateDependencies({ tenantId, projectId }) : NO_DEPS;
      return { busy, thi, deps };
    },

    benchmark: ({ tenantId, planId }) => assessBenchmark({ tenantId, planId }),

    synthesis: ({ tenantId, planId }) => buildReviewReport({ tenantId, planId }),

    simulateHeadcount: ({ tenantId, planId, role, delta }) =>
      simulateHeadcount({ tenantId, planId, role, delta }),

    recommendHiring: ({ tenantId, planId }) => recommendHiring({ tenantId, planId }),

    findSimilarProjects: ({ tenantId, planId, k }) => findSimilarProjects({ tenantId, planId, k }),

    capacityGap: ({ tenantId, planId }) => computeRoleCapacityGap({ tenantId, planId }),

    issueReport: ({ tenantId, actorUserId, planId }) =>
      saveReviewReport({ session: { tenant_id: tenantId, user_id: actorUserId }, planId }),
  };
}
