import type { AgentResult, Citation, SpecializedAgentSpec, TrustEnvelope } from '@seta/agent-sdk';
import type { BenchmarkAssessment } from '@seta/pmo';
import type { PmoReviewPort } from '../ports.ts';
import { BenchmarkOutputSchema, type PlanInput, PlanInputSchema } from '../schemas.ts';

export interface BenchmarkAgentDeps {
  port: PmoReviewPort;
}

/**
 * Benchmark & Velocity specialist — compares the plan's velocity against a
 * cohort of similar historical projects (selected by project type), excluding
 * outliers and tiny projects (F-06). Degrades to "insufficient benchmark data"
 * rather than guessing when the cohort is too small.
 */
export function makeBenchmarkAgent(
  deps: BenchmarkAgentDeps,
): SpecializedAgentSpec<PlanInput, BenchmarkAssessment> {
  return {
    id: 'pmo.benchmark',
    description:
      'Compares plan velocity against similar historical projects, excluding outliers (deterministic cohort).',
    inputSchema: PlanInputSchema,
    outputSchema: BenchmarkOutputSchema,
    run: async (input, ctx): Promise<AgentResult<BenchmarkAssessment>> => {
      const result = await deps.port.benchmark({ tenantId: ctx.tenantId, planId: input.planId });

      const citations: Citation[] = [
        { kind: 'doc', id: input.planId, label: `Plan ${input.planId}` },
        ...result.similar_projects.map<Citation>((projectId) => ({
          kind: 'doc',
          id: `DS05:${projectId}`,
          label: projectId,
        })),
      ];
      const trust: TrustEnvelope = {
        reasoningTrace: [
          {
            step: 'benchmark_velocity',
            detail: result.insufficient_data
              ? `insufficient benchmark data (cohort=${result.similar_projects.length})`
              : `cohort=${result.similar_projects.length}, outliers excluded: ${result.outliers_excluded.join(', ') || '(none)'} · velocity ${result.velocity.rag ?? 'n/a'}`,
            at: new Date().toISOString(),
          },
        ],
        evidenceCitations: citations,
        // Lower confidence when the engine itself flags too little history.
        confidenceScore: result.insufficient_data ? 0.4 : 0.85,
      };
      return { result, trust };
    },
  };
}
