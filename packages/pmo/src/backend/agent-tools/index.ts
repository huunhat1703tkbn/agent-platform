import type { AgentTool } from '@seta/agent-sdk';
import { pmoBusyRateCalcTool } from './busy-rate-calc.ts';
import { pmoDependencyValidatorTool } from './dependency-validator.ts';
import { pmoSaveReviewReportTool } from './save-review-report.ts';
import { pmoSectionCheckerTool } from './section-checker.ts';
import { pmoThiScorerTool } from './thi-scorer.ts';

export {
  pmoBusyRateCalcTool,
  pmoDependencyValidatorTool,
  pmoSaveReviewReportTool,
  pmoSectionCheckerTool,
  pmoThiScorerTool,
};

/** Read tools (pmo.plan.read) the ProjectPlanGuard agent composes onto its runtime. */
export const pmoReadTools: AgentTool[] = [
  pmoSectionCheckerTool,
  pmoDependencyValidatorTool,
  pmoBusyRateCalcTool,
  pmoThiScorerTool,
];

/** All PMO agent tools, including the HITL-gated write (pmo.review.write). */
export const pmoAgentTools: AgentTool[] = [...pmoReadTools, pmoSaveReviewReportTool];
