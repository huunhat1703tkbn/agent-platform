import type { AgentResult, Citation, SpecializedAgentSpec, TrustEnvelope } from '@seta/agent-sdk';
import type { ReviewReport } from '@seta/pmo';
import type { PmoReviewPort } from '../ports.ts';
import { type PlanInput, PlanInputSchema, SynthesisOutputSchema } from '../schemas.ts';

export interface SynthesisAgentDeps {
  port: PmoReviewPort;
}

/**
 * Synthesis & Recommendation specialist — the reasoning tier. Composes the
 * per-dimension signals into the authoritative DS07 roll-up: feasibility status,
 * the cross-dimension conflict (the differentiator — a plan can pass compliance
 * yet be infeasible), risk warnings, and recommended adjustments. The pmo engine
 * applies the §5 roll-up deterministically; the agent attaches the trust envelope
 * (confidence degrades when the benchmark is data-starved).
 */
export function makeSynthesisAgent(
  deps: SynthesisAgentDeps,
): SpecializedAgentSpec<PlanInput, ReviewReport> {
  return {
    id: 'pmo.synthesis',
    description:
      'Rolls up all dimensions into the DS07 verdict, reconciling cross-dimension conflicts.',
    inputSchema: PlanInputSchema,
    outputSchema: SynthesisOutputSchema,
    run: async (input, ctx): Promise<AgentResult<ReviewReport>> => {
      const result = await deps.port.synthesis({ tenantId: ctx.tenantId, planId: input.planId });

      const citations: Citation[] = [
        { kind: 'doc', id: input.planId, label: `Plan ${input.planId}` },
        ...result.pillars.map<Citation>((p) => ({
          kind: 'doc',
          id: `${input.planId}:${p.dimension}`,
          label: `${p.dimension} (${p.rag})`,
        })),
      ];
      const trust: TrustEnvelope = {
        reasoningTrace: [
          {
            step: 'synthesize_ds07',
            detail: `${result.feasibility_status}${result.cross_dimension_conflict ? ` · cross-dimension conflict: ${result.cross_dimension_conflict}` : ''}`,
            at: new Date().toISOString(),
          },
        ],
        evidenceCitations: citations,
        // The engine flags low confidence when the benchmark cohort is too small.
        confidenceScore: result.confidence === 'high' ? 0.9 : 0.5,
      };
      return { result, trust };
    },
  };
}
