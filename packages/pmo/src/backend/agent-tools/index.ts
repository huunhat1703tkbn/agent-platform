import type { AgentTool } from '@seta/agent-sdk';
import { pmoBusyRateCalcTool } from './busy-rate-calc.ts';
import { pmoDependencyValidatorTool } from './dependency-validator.ts';
import { pmoSectionCheckerTool } from './section-checker.ts';
import { pmoThiScorerTool } from './thi-scorer.ts';

export { pmoBusyRateCalcTool, pmoDependencyValidatorTool, pmoSectionCheckerTool, pmoThiScorerTool };

/** The PMO read tools the ProjectPlanGuard agent composes onto its runtime. */
export const pmoAgentTools: AgentTool[] = [
  pmoSectionCheckerTool,
  pmoDependencyValidatorTool,
  pmoBusyRateCalcTool,
  pmoThiScorerTool,
];
