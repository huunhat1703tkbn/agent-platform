export { resetPmoDb } from './backend/db/client.ts';
export {
  assessBenchmark,
  type BenchmarkAssessment,
  type CohortResult,
  compareVelocity,
  historicalVelocityMdMonth,
  selectCohort,
  type VelocityComparison,
} from './backend/domain/benchmark.ts';
export {
  assessRoleCapacity,
  type CapacityGapAssessment,
  canonicalRole,
  computeRoleCapacityGap,
  ROLE_ALIASES,
  type RoleCapacityGap,
  spreadEffortByMonth,
  type TaskEffort,
} from './backend/domain/capacity.ts';
export {
  type ComplianceGap,
  type ComplianceResult,
  type CustomSection,
  type GapSeverity,
  type SectionCheckRow,
  scoreCompliance,
  scoreComplianceFromRows,
  type TemplateRow,
} from './backend/domain/compliance.ts';
export {
  analyzeDependencyGraph,
  type DanglingDependency,
  type DependencyResult,
  type OrderViolation,
  type TaskNode,
  validateDependencies,
} from './backend/domain/dependencies.ts';
export {
  assessBusyRate,
  assessThi,
  type BusyRateAssessment,
  type MemberBusyRate,
  type ThiAssessment,
} from './backend/domain/feasibility.ts';
export {
  cohortOnTimeFromSchedule,
  computeOnTimeHistory,
  computePlanVelocity,
  computeScheduleRealism,
  monthsSpan,
  type OnTimeHistory,
  type PlanVelocity,
  planVelocityMdMonth,
  type ScheduleRealism,
  scheduleAdherence,
  scheduleRealism,
  sumEffortMd,
} from './backend/domain/plan-metrics.ts';
export {
  getLatestReportStatus,
  getPlanOverview,
  listPlans,
  type PlanListItem,
  type PlanOverview,
} from './backend/domain/plans.ts';
export {
  classifyBusyRate,
  classifyOnTime,
  classifyThi,
  type RagStatus,
  ragWorst,
} from './backend/domain/rag.ts';
export {
  type BandMetric,
  computeRiskScore,
  detectBusFactor,
  detectCapacityNearFull,
  detectFragileGreen,
  detectNoCohort,
  type LatentRisk,
  type RiskScore,
  type RiskSeverity,
  scanLatentRisks,
} from './backend/domain/risk-signals.ts';
export {
  getReviewReports,
  type SaveReviewReportResult,
  saveReviewReport,
} from './backend/domain/save-review-report.ts';
export {
  loadBundledDataset,
  type PmoDataset,
  type SeedResult,
  seedPmoDataset,
} from './backend/domain/seed-dataset.ts';
export {
  buildReviewReport,
  detectCrossDimensionConflict,
  type FeasibilityStatus,
  type Pillar,
  type RecommendedAdjustment,
  type ReviewReport,
  type RiskWarning,
  rollupFeasibilityStatus,
} from './backend/domain/synthesis.ts';
export {
  DEFAULT_TARGET_BUSY_PCT,
  type HeadcountSimulation,
  type HiringRecommendation,
  hiringToTarget,
  type RoleChangeSimulation,
  type RoleProjection,
  recommendHiring,
  scaleProjectedBusy,
  simulateHeadcount,
  simulateRoleChange,
} from './backend/domain/whatif.ts';
