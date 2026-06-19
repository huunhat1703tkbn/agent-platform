/**
 * Structured I/O for the pmo-review orchestration. The four specialist
 * sub-agents wrap the pmo module's deterministic engine, so their outputs ARE
 * the engine's domain types (re-validated only loosely here — the engine owns
 * the contract). The orchestrator's own I/O is the chat-turn boundary.
 */
import type {
  BenchmarkAssessment,
  BusyRateAssessment,
  ComplianceResult,
  DependencyResult,
  ReviewReport,
  ThiAssessment,
} from '@seta/pmo';
import { z } from 'zod';

/** Every sub-agent keys off a single plan id (e.g. "PLAN-002"). */
export const PlanInputSchema = z.object({
  planId: z.string().trim().min(1),
});
export type PlanInput = z.infer<typeof PlanInputSchema>;

/** The feasibility sub-agent folds the three feasibility reads into one result:
 *  per-member + peak busy rate (DS03/DS07), THI (N10), and dependency/timeline
 *  validation (Tarjan SCC + phase-order) — each individually deterministic. */
export interface FeasibilityFindings {
  busy: BusyRateAssessment;
  thi: ThiAssessment;
  deps: DependencyResult;
}

/** Loose runtime schemas for the sub-agent outputs. The pmo engine is the
 *  authority on these shapes (and is unit-tested against the Answer_Key); we
 *  only need a ZodType<T> to satisfy the SpecializedAgentSpec contract. */
export const ComplianceOutputSchema = z.custom<ComplianceResult>(
  (v) => typeof v === 'object' && v !== null,
);
export const FeasibilityOutputSchema = z.custom<FeasibilityFindings>(
  (v) => typeof v === 'object' && v !== null,
);
export const BenchmarkOutputSchema = z.custom<BenchmarkAssessment>(
  (v) => typeof v === 'object' && v !== null,
);
export const SynthesisOutputSchema = z.custom<ReviewReport>(
  (v) => typeof v === 'object' && v !== null,
);

/** The orchestrator chat turn. taskId is unused (PMO review keys off plan ids
 *  named in the text) but kept so the runtime's RunCtx run-input shape matches
 *  the engine's `{ userText, taskId }` chat contract. */
export const OrchestratorInputSchema = z.object({
  userText: z.string(),
  taskId: z.string().nullable(),
});
export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;

/** The assembled result of a (non-suspended) review chat turn. */
export interface OrchestratorResult {
  /** The DS07 review draft produced by the synthesis sub-agent. */
  review?: ReviewReport;
  /** Set when a report was issued on a resumed approval. */
  issued?: { planId: string; reportId: string; feasibilityStatus: string };
  /** Conversational / honest-failure prose when no structured branch fired. */
  message?: string;
}

export const OrchestratorResultSchema = z.custom<OrchestratorResult>(
  (v) => typeof v === 'object' && v !== null,
);
