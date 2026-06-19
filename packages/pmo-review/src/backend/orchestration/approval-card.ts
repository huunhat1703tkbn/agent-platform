import type { ApprovalCard } from '@seta/agent-sdk';
import type { ReviewReport } from '@seta/pmo';

export interface BuildReviewApprovalCardOpts {
  draft: ReviewReport;
  tenantId: string;
  userId: string;
}

function metric(label: string, value: number | null, suffix = ''): { k: string; v: string } {
  return { k: label, v: value == null ? '—' : `${Math.round(value * 10) / 10}${suffix}` };
}

/**
 * Maps a finished DS07 review draft onto the SDK ApprovalCard rendered by the
 * in-thread HitlApprovalCard component. Issuing the report is the orchestrator's
 * ONLY write, so the card is the PMO checkpoint: approve → persist + emit
 * pmo.report.issued; decline → leave the plan unissued.
 *
 * The resume payload (argsPatch) carries the decision the review-plan composite
 * reads back from `ctx.agent.resumeData` on resume.
 */
export function buildReviewApprovalCard(opts: BuildReviewApprovalCardOpts): ApprovalCard {
  const { draft, tenantId, userId } = opts;
  const planId = draft.plan_id;
  const conflictNote = draft.cross_dimension_conflict
    ? `\n\n⚠️ Cross-dimension conflict: ${draft.cross_dimension_conflict}`
    : '';

  return {
    toolCallId: `pmo-review:${planId}`,
    intent: `Issue DS07 review report for "${draft.project_name ?? planId}"`,
    riskBadge: 'write',
    summary: `${draft.feasibility_status} — ${draft.feasibility_reason}`,
    details: [
      {
        kind: 'kvTable',
        rows: [
          metric('Compliance', draft.compliance_score_pct, '%'),
          metric('Peak busy rate', draft.peak_role_busy_rate_pct, '%'),
          metric('THI', draft.thi_pct, '%'),
          metric('On-time history', draft.on_time_history_pct, '%'),
          { k: 'Gaps', v: String(draft.gap_report.length) },
          { k: 'Risk warnings', v: String(draft.risk_warnings.length) },
        ],
      },
      {
        kind: 'text',
        body:
          draft.pillars.map((p) => `${p.dimension}: ${p.rag}`).join(' · ') +
          conflictNote +
          (draft.confidence === 'low' ? '\n\nConfidence: LOW (insufficient benchmark data).' : ''),
      },
      { kind: 'confidence', score: draft.confidence === 'high' ? 0.9 : 0.5 },
    ],
    primary: {
      label: 'Issue DS07 report',
      argsPatch: { decision: 'approve' },
    },
    alternates: [],
    decline: {
      label: 'Do not issue',
      argsPatch: { decision: 'reject' },
    },
    meta: {
      tenantId,
      userId,
      agentPath: ['pmo', 'reviewOrchestrator'],
      toolId: 'pmo_reviewPlan',
      ts: new Date().toISOString(),
    },
  };
}
