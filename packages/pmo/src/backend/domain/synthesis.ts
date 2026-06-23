/**
 * Synthesis & roll-up — combine the per-dimension feasibility signals into the
 * DS07 review report. Contract: docs/projectplanguard/05-feasibility-rules-and-ds07.md §5–§6.
 *
 * The differentiator (memory: "a plan can pass compliance yet be infeasible"): even when
 * every pillar is individually acceptable, a cross-dimension conflict (looks compliant but a
 * feasibility pillar is not green) forces CAUTION so Synthesis must reconcile it.
 */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { assessBenchmark, type BenchmarkAssessment } from './benchmark.ts';
import { type CapacityGapAssessment, computeRoleCapacityGap } from './capacity.ts';
import { type ComplianceResult, scoreCompliance } from './compliance.ts';
import { type DependencyResult, validateDependencies } from './dependencies.ts';
import { assessBusyRate, assessThi, type BusyRateAssessment } from './feasibility.ts';
import { computePlanVelocity } from './plan-metrics.ts';
import { classifyCapacityOverload, type RagStatus } from './rag.ts';
import {
  type BandMetric,
  computeRiskScore,
  type LatentRisk,
  type RiskScore,
  scanLatentRisks,
} from './risk-signals.ts';

export type FeasibilityStatus = 'Feasible (Green)' | 'Needs review (Yellow)' | 'Not feasible (Red)';

export interface Pillar {
  dimension: string;
  rag: RagStatus;
  reason?: string;
}

// A plan that looks compliant (high score) yet has a non-green feasibility pillar is the
// "hidden" conflict worth surfacing; a low-compliance plan with red pillars is plainly infeasible.
const COMPLIANT_THRESHOLD_PCT = 85;

export function detectCrossDimensionConflict(
  complianceScorePct: number,
  pillars: Pillar[],
): { conflict: boolean; explanation: string | null } {
  const feasibility = pillars.filter((p) => p.dimension !== 'Compliance');
  const offenders = feasibility.filter((p) => p.rag !== 'Green');
  if (complianceScorePct >= COMPLIANT_THRESHOLD_PCT && offenders.length > 0) {
    const dims = offenders.map((o) => `${o.dimension} (${o.rag})`).join(', ');
    return {
      conflict: true,
      explanation: `Plan appears compliant (${Math.round(complianceScorePct)}%) but feasibility is at risk: ${dims}.`,
    };
  }
  return { conflict: false, explanation: null };
}

export function rollupFeasibilityStatus(
  pillars: Pillar[],
  hasCrossDimensionConflict: boolean,
): FeasibilityStatus {
  if (pillars.some((p) => p.rag === 'Red')) return 'Not feasible (Red)';
  if (hasCrossDimensionConflict || pillars.some((p) => p.rag === 'Yellow'))
    return 'Needs review (Yellow)';
  return 'Feasible (Green)';
}

export interface RiskWarning {
  dimension: string;
  rag: RagStatus;
  metric: string;
  value_pct?: number | null;
  why: string;
  evidence: { source: string; row_id: string };
}

export interface RecommendedAdjustment {
  id: string;
  action: string;
  rationale: string;
  addresses: string[];
}

export interface ReviewReport {
  plan_id: string;
  project_id: string | null;
  project_name: string | null;
  // header metrics (mirror the DS07 sheet)
  effort_md: number | null;
  duration_months: number | null;
  velocity_md_month: number | null;
  team_size: number | null;
  risk_count: number | null;
  thi_pct: number | null;
  peak_role_busy_rate_pct: number | null;
  on_time_history_pct: number | null;
  compliance_score_pct: number;
  feasibility_status: FeasibilityStatus;
  feasibility_reason: string;
  confidence: 'high' | 'low';
  pillars: Pillar[];
  cross_dimension_conflict: string | null;
  gap_report: ComplianceResult['gaps'];
  custom_sections: ComplianceResult['custom_sections'];
  risk_warnings: RiskWarning[];
  benchmark: BenchmarkAssessment;
  recommended_adjustments: RecommendedAdjustment[];
  // Weighted plan-riskiness score + advisory risks that fire even when pillars are Green.
  risk_score: RiskScore;
  latent_risks: LatentRisk[];
  capacity: CapacityGapAssessment;
  audit: { tools_run: string[]; incomplete_steps: string[] };
}

/**
 * Compose the full deterministic DS07 review report for a plan: runs compliance,
 * dependency, busy-rate, THI and benchmark assessments, derives the pillar RAGs, applies
 * the §5 roll-up (with the cross-dimension conflict rule) and assembles risks + recommendations.
 */
export async function buildReviewReport(input: {
  tenantId: string;
  planId: string;
}): Promise<ReviewReport> {
  const { tenantId, planId } = input;

  const [summary] = await pmoDb()
    .select()
    .from(t.ds07Summary)
    .where(and(eq(t.ds07Summary.tenant_id, tenantId), eq(t.ds07Summary.plan_id, planId)))
    .limit(1);
  const projectId = summary?.project_id ?? null;

  const compliance = await scoreCompliance({ tenantId, planId });
  // effort_md, duration_months and velocity are all derived from DS01 (Σ effort +
  // the inclusive task-date span ÷ 28), not read from the DS07 header claims.
  const planVelocity = await computePlanVelocity({ tenantId, planId });
  const busy = await assessBusyRate({ tenantId, planId });
  const thi = await assessThi({ tenantId, planId });
  const benchmark = await assessBenchmark({ tenantId, planId });
  const deps = projectId
    ? await validateDependencies({ tenantId, projectId })
    : ({ has_cycle: false, cycles: [], order_violations: [], dangling: [] } as DependencyResult);

  const capacity = await computeRoleCapacityGap({ tenantId, planId });
  const tasks = projectId
    ? await pmoDb()
        .select({ task_id: t.ds01Tasks.task_id, assignee_id: t.ds01Tasks.assignee_id })
        .from(t.ds01Tasks)
        .where(and(eq(t.ds01Tasks.tenant_id, tenantId), eq(t.ds01Tasks.project_id, projectId)))
    : [];

  const pillars = buildPillars({ compliance, busy, thi, benchmark, deps, summary, capacity });
  const conflict = detectCrossDimensionConflict(compliance.score_pct, pillars);
  const feasibility_status = rollupFeasibilityStatus(pillars, conflict.conflict);

  // Latent risks fire even when every pillar is Green; the band metrics carry the raw
  // values + Green ranges so detectFragileGreen can flag "Green but near the edge".
  const band_metrics: BandMetric[] = [];
  if (busy.peak_role_busy_rate_pct != null)
    band_metrics.push({
      dimension: 'Resource',
      value: busy.peak_role_busy_rate_pct,
      green_lo: 85,
      green_hi: 110,
      unit: '%',
    });
  if (thi.thi_pct != null)
    band_metrics.push({
      dimension: 'THI',
      value: thi.thi_pct,
      green_lo: 15,
      green_hi: 25,
      unit: '%',
    });
  if (benchmark.velocity.deviation_pct != null)
    band_metrics.push({
      dimension: 'Benchmark',
      value: benchmark.velocity.deviation_pct,
      green_lo: -15,
      green_hi: 15,
      unit: '%',
    });
  if (benchmark.on_time_history_pct != null)
    band_metrics.push({
      dimension: 'On-time',
      value: benchmark.on_time_history_pct,
      green_lo: 90,
      green_hi: null,
      unit: '%',
    });

  const latent_risks = scanLatentRisks({
    band_metrics,
    benchmark: {
      insufficient_data: benchmark.insufficient_data,
      cohort_project_type: benchmark.cohort_project_type,
    },
    capacity: { bottleneck: capacity.bottleneck },
    tasks,
  });
  const risk_score = computeRiskScore({ pillars, latent_risks });

  const reasons = pillars
    .filter((p) => p.rag === 'Red')
    .map((p) => p.reason ?? p.dimension)
    .filter(Boolean);
  const feasibility_reason =
    feasibility_status === 'Not feasible (Red)'
      ? `Not feasible (Red): ${reasons.join('; ')}`
      : conflict.conflict
        ? (conflict.explanation as string)
        : feasibility_status;

  return {
    plan_id: planId,
    project_id: projectId,
    project_name: summary?.project_name ?? null,
    effort_md: planVelocity.effort_md,
    duration_months: planVelocity.duration_months,
    velocity_md_month: planVelocity.velocity_md_month,
    team_size: summary?.team_size ?? null,
    risk_count: summary?.risk_count ?? null,
    thi_pct: thi.thi_pct,
    peak_role_busy_rate_pct: busy.peak_role_busy_rate_pct,
    on_time_history_pct: benchmark.on_time_history_pct,
    compliance_score_pct: compliance.score_pct,
    feasibility_status,
    feasibility_reason,
    confidence: benchmark.insufficient_data ? 'low' : 'high',
    pillars,
    cross_dimension_conflict: conflict.explanation,
    gap_report: compliance.gaps,
    custom_sections: compliance.custom_sections,
    risk_warnings: buildRiskWarnings({ busy, thi, deps, compliance, capacity }),
    benchmark,
    recommended_adjustments: buildRecommendations({ compliance, busy, thi, deps }),
    risk_score,
    latent_risks,
    capacity,
    audit: {
      tools_run: [
        'scoreCompliance',
        'assessBusyRate',
        'assessThi',
        'assessBenchmark',
        'validateDependencies',
        'computeRoleCapacityGap',
        'scanLatentRisks',
      ],
      incomplete_steps: [],
    },
  };
}

function buildPillars(args: {
  compliance: ComplianceResult;
  busy: BusyRateAssessment;
  thi: { rag: RagStatus | null; thi_pct: number | null };
  benchmark: BenchmarkAssessment;
  deps: DependencyResult;
  summary?: { risk_count: number | null };
  capacity: CapacityGapAssessment;
}): Pillar[] {
  const { compliance, busy, thi, benchmark, deps, summary, capacity } = args;
  const pillars: Pillar[] = [];

  // Compliance: Red when below threshold, Yellow when there are gaps, else Green.
  const complianceRag: RagStatus =
    compliance.score_pct < 70 ? 'Red' : compliance.gaps.length > 0 ? 'Yellow' : 'Green';
  pillars.push({
    dimension: 'Compliance',
    rag: complianceRag,
    reason: `compliance ${Math.round(compliance.score_pct)}%`,
  });

  // Resource: driven by the RAW capacity-gap (DS01 effort × DS08 capacity), not the DS07
  // header. The bottleneck role's projected peak (org current load + this plan's peak-month
  // increment) is the real contention signal; classified one-sided (only over-allocation is
  // a feasibility risk). Falls back to the DS03 member-level worst when no role mapped to
  // capacity (data gap) — never to the DS07 header.
  const bottleneck = capacity.bottleneck;
  if (bottleneck && bottleneck.projected_busy_rate_pct != null) {
    const pct = bottleneck.projected_busy_rate_pct;
    const when = bottleneck.peak_month ? ` in ${bottleneck.peak_month}` : '';
    pillars.push({
      dimension: 'Resource',
      rag: classifyCapacityOverload(pct),
      reason: `${bottleneck.role} projected ~${Math.round(pct)}%${when} (computed from DS01×DS08)`,
    });
  } else if (busy.max_member_rag) {
    pillars.push({
      dimension: 'Resource',
      rag: busy.max_member_rag,
      reason: 'resource pressure (member-level; no role capacity mapped)',
    });
  }

  // Timeline/Dependency: Red on a cycle, Yellow on an order violation.
  const depRag: RagStatus = deps.has_cycle
    ? 'Red'
    : deps.order_violations.length > 0
      ? 'Yellow'
      : 'Green';
  pillars.push({
    dimension: 'Timeline/Dependency',
    rag: depRag,
    reason: deps.has_cycle ? 'dependency cycle' : 'dependency order violation',
  });

  // THI.
  if (thi.rag) {
    const pct = thi.thi_pct;
    const reason =
      thi.rag === 'Green'
        ? `THI ${pct ?? '?'}% within healthy 15–25% band`
        : `THI ${pct ?? '?'}% outside healthy 15–25% band`;
    pillars.push({ dimension: 'THI', rag: thi.rag, reason });
  }

  // Benchmark/velocity.
  if (benchmark.velocity.rag)
    pillars.push({
      dimension: 'Benchmark',
      rag: benchmark.velocity.rag,
      reason: 'velocity deviates from cohort',
    });

  // Risk: missing register defaults to Red (F-01); else Green when at least one risk is tracked.
  const riskRed = compliance.risk_register_missing || (summary?.risk_count ?? 0) === 0;
  const riskReason = riskRed
    ? compliance.risk_register_missing
      ? 'missing Risk Register'
      : 'no risks tracked'
    : `${summary?.risk_count ?? 0} risk(s) tracked`;
  pillars.push({
    dimension: 'Risk',
    rag: riskRed ? 'Red' : 'Green',
    reason: riskReason,
  });

  return pillars;
}

function buildRiskWarnings(args: {
  busy: BusyRateAssessment;
  thi: { thi_pct: number | null; rag: RagStatus | null };
  deps: DependencyResult;
  compliance: ComplianceResult;
  capacity: CapacityGapAssessment;
}): RiskWarning[] {
  const { busy, thi, deps, compliance, capacity } = args;
  const warnings: RiskWarning[] = [];

  const rawPeak = capacity.bottleneck?.projected_busy_rate_pct ?? null;
  if (rawPeak != null && rawPeak > 110) {
    warnings.push({
      dimension: 'Resource',
      rag: classifyCapacityOverload(rawPeak),
      metric: 'Capacity gap (DS01×DS08)',
      value_pct: rawPeak,
      why: `${capacity.bottleneck?.role} projected ~${Math.round(rawPeak)}% — peak demand exceeds capacity.`,
      evidence: { source: 'DS01/DS08', row_id: capacity.bottleneck?.role ?? '' },
    });
  }

  // Reconciliation flag: the DS07 header peak materially disagrees with the computed peak.
  const ds07Peak = busy.peak_role_busy_rate_pct;
  if (ds07Peak != null && rawPeak != null && Math.abs(ds07Peak - rawPeak) > 15) {
    warnings.push({
      dimension: 'Resource',
      rag: 'Yellow',
      metric: 'Capacity reconciliation',
      value_pct: rawPeak,
      why: `DS07 states peak busy ${Math.round(ds07Peak)}% but the computed (DS01×DS08) peak is ${Math.round(rawPeak)}% for ${capacity.bottleneck?.role} — reconcile the header.`,
      evidence: { source: 'DS07 vs DS01/DS08', row_id: capacity.bottleneck?.role ?? '' },
    });
  }
  if (thi.rag && thi.rag !== 'Green') {
    warnings.push({
      dimension: 'THI',
      rag: thi.rag,
      metric: 'THI (N10)',
      value_pct: thi.thi_pct,
      why: `THI ${thi.thi_pct}% is outside the healthy 15–25% band.`,
      evidence: { source: 'DS07', row_id: busy.plan_id },
    });
  }
  if (deps.has_cycle) {
    warnings.push({
      dimension: 'Timeline/Dependency',
      rag: 'Red',
      metric: 'Acyclicity (S06)',
      why: `Dependency cycle detected: ${deps.cycles.map((c) => c.join('↔')).join('; ')}.`,
      evidence: { source: 'DS01', row_id: deps.cycles.flat().join(',') },
    });
  }
  if (compliance.risk_register_missing) {
    warnings.push({
      dimension: 'Risk',
      rag: 'Red',
      metric: 'Risk Register (S07)',
      why: 'Risk Register is missing → Risk pillar defaults to Red.',
      evidence: { source: 'DS06', row_id: 'S07' },
    });
  }
  return warnings;
}

function buildRecommendations(args: {
  compliance: ComplianceResult;
  busy: BusyRateAssessment;
  thi: { rag: RagStatus | null };
  deps: DependencyResult;
}): RecommendedAdjustment[] {
  const { compliance, busy, thi, deps } = args;
  const recs: RecommendedAdjustment[] = [];
  let n = 0;
  const id = () => `R${++n}`;

  if (compliance.risk_register_missing)
    recs.push({
      id: id(),
      action: 'Add a Risk Register (S07) with ≥1 entry incl. severity + owner',
      rationale: 'Mandatory PMO section; unblocks the Risk pillar.',
      addresses: ['F-01'],
    });
  if (busy.peak_rag === 'Red')
    recs.push({
      id: id(),
      action: 'Rebalance the bottleneck role or extend the phase to bring peak busy ≤110%',
      rationale: `${Math.round(busy.peak_role_busy_rate_pct ?? 0)}% busy is infeasible; check DS08 headroom.`,
      addresses: ['F-03'],
    });
  if (deps.has_cycle)
    recs.push({
      id: id(),
      action: 'Break the dependency cycle and sequence build before test',
      rationale: 'The dependency graph must be acyclic (S06).',
      addresses: ['F-1C'],
    });
  if (thi.rag === 'Red')
    recs.push({
      id: id(),
      action: 'Increase non-dev allocation to lift THI into the 15–25% band',
      rationale: 'Too little non-dev budget leaves no room for quality/risk work.',
      addresses: ['F-03'],
    });
  for (const gap of compliance.gaps.filter((g) => g.status === 'Weak'))
    recs.push({
      id: id(),
      action: `Strengthen ${gap.component_name ?? gap.section_code} (currently weak)`,
      rationale: 'Weak sections reduce the compliance score and add delivery risk.',
      addresses: ['F-02'],
    });

  return recs;
}
