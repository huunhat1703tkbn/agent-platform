import type { AgentResult, Citation, SpecializedAgentSpec, TrustEnvelope } from '@seta/agent-sdk';
import type { PmoReviewPort } from '../ports.ts';
import {
  type FeasibilityFindings,
  FeasibilityOutputSchema,
  type PlanInput,
  PlanInputSchema,
} from '../schemas.ts';

export interface FeasibilityAgentDeps {
  port: PmoReviewPort;
}

/**
 * Feasibility specialist — folds the three deterministic feasibility reads into
 * one finding: role/member busy rate (DS03/DS07 N01), Talent Health Index (N10),
 * and dependency/timeline validation (Tarjan SCC cycle detection + phase-order).
 * No LLM: the inputs are plain reads and the classification is a pure function,
 * so an LLM step would add only latency and hallucination risk.
 */
export function makeFeasibilityAgent(
  deps: FeasibilityAgentDeps,
): SpecializedAgentSpec<PlanInput, FeasibilityFindings> {
  return {
    id: 'pmo.feasibility',
    description:
      'Assesses resource overload (busy rate), THI, and dependency/timeline risks for a plan (deterministic).',
    inputSchema: PlanInputSchema,
    outputSchema: FeasibilityOutputSchema,
    run: async (input, ctx): Promise<AgentResult<FeasibilityFindings>> => {
      const result = await deps.port.feasibility({ tenantId: ctx.tenantId, planId: input.planId });
      const { busy, thi, deps: dep } = result;

      const citations: Citation[] = [
        { kind: 'doc', id: input.planId, label: `Plan ${input.planId}` },
      ];
      if (dep.has_cycle) {
        citations.push({
          kind: 'doc',
          id: `${input.planId}:DS01:cycle`,
          label: `Dependency cycle: ${dep.cycles.map((c) => c.join('↔')).join('; ')}`,
        });
      }

      const trust: TrustEnvelope = {
        reasoningTrace: [
          {
            step: 'assess_feasibility',
            detail: `peak busy ${Math.round(busy.peak_role_busy_rate_pct ?? 0)}% (${busy.peak_rag ?? 'n/a'}) · THI ${thi.thi_pct ?? 'n/a'}% (${thi.rag ?? 'n/a'}) · ${dep.has_cycle ? 'dependency CYCLE' : `${dep.order_violations.length} order violation(s)`}`,
            at: new Date().toISOString(),
          },
        ],
        evidenceCitations: citations,
        confidenceScore: 0.9,
      };
      return { result, trust };
    },
  };
}
