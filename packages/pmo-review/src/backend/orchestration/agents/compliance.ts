import type { AgentResult, Citation, SpecializedAgentSpec, TrustEnvelope } from '@seta/agent-sdk';
import type { ComplianceResult } from '@seta/pmo';
import type { PmoReviewPort } from '../ports.ts';
import { ComplianceOutputSchema, type PlanInput, PlanInputSchema } from '../schemas.ts';

export interface ComplianceAgentDeps {
  port: PmoReviewPort;
}

/**
 * Compliance specialist — scores a plan against the PMO standard template
 * (DS02 × DS06): weighted compliance %, section gaps, custom-section flags, and
 * the S07-missing default. Deterministic (the pmo engine owns the rules); the
 * agent layer adds the trust envelope (every gap cites its DS06 row).
 */
export function makeComplianceAgent(
  deps: ComplianceAgentDeps,
): SpecializedAgentSpec<PlanInput, ComplianceResult> {
  return {
    id: 'pmo.compliance',
    description:
      'Scores a project plan against the PMO standard template (compliance %, gaps, custom sections).',
    inputSchema: PlanInputSchema,
    outputSchema: ComplianceOutputSchema,
    run: async (input, ctx): Promise<AgentResult<ComplianceResult>> => {
      const result = await deps.port.compliance({ tenantId: ctx.tenantId, planId: input.planId });

      const citations: Citation[] = [
        { kind: 'doc', id: input.planId, label: `Plan ${input.planId}` },
        ...result.gaps.map<Citation>((g) => ({
          kind: 'doc',
          id: `${input.planId}:${g.evidence.source}:${g.evidence.row_id}`,
          label: `${g.section_code ?? g.component_id} (${g.status})`,
        })),
      ];
      const trust: TrustEnvelope = {
        reasoningTrace: [
          {
            step: 'score_compliance',
            detail: `compliance ${Math.round(result.score_pct)}% · ${result.gaps.length} gap(s) · ${result.custom_sections.length} custom · risk register ${result.risk_register_missing ? 'MISSING' : 'present'}`,
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
