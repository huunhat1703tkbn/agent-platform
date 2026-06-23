/**
 * The dependency-injection boundary between the orchestrator and the pmo
 * feature module. apps/server binds these to the @seta/pmo public surface at
 * the composition root (the only layer allowed to compose feature modules into
 * the engine). The sub-agents and the issue composite call ONLY this port, so
 * they stay testable with an in-memory fake.
 */
import type {
  BenchmarkAssessment,
  CapacityGapAssessment,
  ComplianceResult,
  HeadcountSimulation,
  HiringRecommendation,
  PlanOverview,
  ReviewReport,
  SaveReviewReportResult,
  SimilarProjectsResult,
} from '@seta/pmo';
import type { FeasibilityFindings } from './schemas.ts';

/** A reviewable plan (DS07 summary row) — for listing + disambiguation. */
export interface PlanSummary {
  planId: string;
  projectName: string | null;
}

export interface PmoReviewPort {
  /** The plans under review (DS07 summary rows). Used to list options and to
   *  validate a plan id before running a review (the clarification path). */
  listPlans(input: { tenantId: string }): Promise<PlanSummary[]>;
  /** A descriptive overview of a plan (metrics + scope, no verdict) for
   *  "describe this project" questions. Null when the plan id is unknown. */
  describePlan(input: { tenantId: string; planId: string }): Promise<PlanOverview | null>;
  /** DS06 × DS02 weighted compliance, gaps, custom-section flags, S07-missing. */
  compliance(input: { tenantId: string; planId: string }): Promise<ComplianceResult>;
  /** Busy rate (DS03/DS07) + THI (N10) + dependency/timeline validation. */
  feasibility(input: { tenantId: string; planId: string }): Promise<FeasibilityFindings>;
  /** Cohort-by-type benchmark + velocity deviation (outliers excluded). */
  benchmark(input: { tenantId: string; planId: string }): Promise<BenchmarkAssessment>;
  /** The full deterministic DS07 roll-up (compliance + feasibility + benchmark
   *  + cross-dimension conflict). The synthesis sub-agent's authoritative draft. */
  synthesis(input: { tenantId: string; planId: string }): Promise<ReviewReport>;
  /** What-if: recompute the Resource pillar + verdict under a headcount change
   *  (+/- N of a role). Read-only — never writes, never goes through HITL. Null
   *  for an unknown plan; flags an unknown role with the available roles. */
  simulateHeadcount(input: {
    tenantId: string;
    planId: string;
    role: string;
    delta: number;
  }): Promise<HeadcountSimulation | null>;
  /** Inverse what-if: how many people to hire for the bottleneck role to hit the
   *  busy target, and whether that alone makes the plan feasible. Null when unknown. */
  recommendHiring(input: {
    tenantId: string;
    planId: string;
  }): Promise<HiringRecommendation | null>;
  /** Top-k historical projects most similar to the plan (deterministic feature
   *  similarity over DS05) with their outcomes. Null for an unknown plan. */
  findSimilarProjects(input: {
    tenantId: string;
    planId: string;
    k?: number;
  }): Promise<SimilarProjectsResult | null>;
  /** Raw per-role capacity gap (DS01 demand × DS08 capacity): which role is the
   *  bottleneck, each role's projected peak busy, and roles over capacity. */
  capacityGap(input: { tenantId: string; planId: string }): Promise<CapacityGapAssessment>;
  /** Persist the issued DS07 report + emit pmo.report.issued. The ONLY write,
   *  guarded by the orchestrator behind a HITL approval gate. */
  issueReport(input: {
    tenantId: string;
    actorUserId: string;
    planId: string;
  }): Promise<SaveReviewReportResult>;
}
