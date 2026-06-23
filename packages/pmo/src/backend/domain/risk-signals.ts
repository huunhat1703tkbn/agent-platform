/**
 * Latent-risk scanner — proactive risk signals that fire EVEN WHEN every RAG pillar
 * is Green. The RAG bands answer "is any dimension out of tolerance?"; this answers
 * "what could still bite us?" — surfaced as *advisory* risks, distinct from the
 * blocking pillar verdict. All checks are deterministic and derived from sheets we
 * already read (DS01 assignees, DS05 cohort sufficiency, DS08 capacity, pillar metrics).
 *
 * Contract background: docs/projectplanguard/05-feasibility-rules-and-ds07.md §3/§5.
 */

import type { RagStatus } from './rag.ts';

export type RiskSeverity = 'low' | 'medium' | 'high';

export interface LatentRisk {
  code: 'fragile_green' | 'no_cohort' | 'capacity_near_full' | 'bus_factor';
  severity: RiskSeverity;
  dimension?: string;
  title: string;
  detail: string;
}

/** A Green-band metric with its numeric value and the inclusive Green range. */
export interface BandMetric {
  dimension: string;
  value: number;
  green_lo: number | null; // null = unbounded below
  green_hi: number | null; // null = unbounded above
  unit?: string;
}

/**
 * Flag a metric that is currently Green but sits within `marginPp` of a Yellow edge —
 * one bad estimate away from slipping. Metrics already outside the Green band are not
 * "fragile green" (they are an explicit pillar finding already).
 */
export function detectFragileGreen(metrics: BandMetric[], marginPp = 3): LatentRisk[] {
  const out: LatentRisk[] = [];
  for (const m of metrics) {
    const aboveLo = m.green_lo == null || m.value >= m.green_lo;
    const belowHi = m.green_hi == null || m.value <= m.green_hi;
    if (!aboveLo || !belowHi) continue; // not Green → not fragile-green

    const nearHi = m.green_hi != null && m.green_hi - m.value <= marginPp;
    const nearLo = m.green_lo != null && m.value - m.green_lo <= marginPp;
    if (nearHi || nearLo) {
      const edge = nearHi ? m.green_hi : m.green_lo;
      out.push({
        code: 'fragile_green',
        severity: 'low',
        dimension: m.dimension,
        title: `${m.dimension} is Green but fragile`,
        detail: `${m.dimension} = ${m.value}${m.unit ?? ''} sits within ${marginPp}pp of the ${edge}${m.unit ?? ''} threshold — one slip flips it to Yellow.`,
      });
    }
  }
  return out;
}

/** Estimation risk: no comparable historical cohort, so the benchmark is unanchored. */
export function detectNoCohort(benchmark: {
  insufficient_data: boolean;
  cohort_project_type?: string;
}): LatentRisk | null {
  if (!benchmark.insufficient_data) return null;
  const type = benchmark.cohort_project_type ? ` for "${benchmark.cohort_project_type}"` : '';
  return {
    code: 'no_cohort',
    severity: 'medium',
    dimension: 'Benchmark',
    title: 'No comparable historical cohort',
    detail: `Too few similar past projects${type} to benchmark against — velocity/on-time signals are estimates, not evidence.`,
  };
}

/** A bottleneck role projected at/above the near-full threshold even if the header is Green. */
export function detectCapacityNearFull(
  bottleneck: {
    role: string;
    projected_busy_rate_pct: number | null;
    peak_month: string | null;
  } | null,
  thresholdPct = 110,
): LatentRisk | null {
  if (!bottleneck || bottleneck.projected_busy_rate_pct == null) return null;
  if (bottleneck.projected_busy_rate_pct < thresholdPct) return null;
  const when = bottleneck.peak_month ? ` in ${bottleneck.peak_month}` : '';
  return {
    code: 'capacity_near_full',
    severity: 'medium',
    dimension: 'Resource',
    title: `${bottleneck.role} capacity is tight`,
    detail: `${bottleneck.role} is projected at ~${Math.round(bottleneck.projected_busy_rate_pct)}%${when} — little slack to absorb slippage.`,
  };
}

/**
 * Bus-factor risk: one member owns more than `threshold` (fraction) of the assigned
 * tasks — losing them stalls a disproportionate share of the plan. Unassigned tasks
 * are excluded from the denominator.
 */
export function detectBusFactor(
  tasks: { task_id: string; assignee_id: string | null }[],
  threshold = 0.5,
): LatentRisk[] {
  const assigned = tasks.filter((t) => t.assignee_id != null);
  if (assigned.length === 0) return [];

  const byMember = new Map<string, number>();
  for (const t of assigned) {
    const id = t.assignee_id as string;
    byMember.set(id, (byMember.get(id) ?? 0) + 1);
  }

  const out: LatentRisk[] = [];
  for (const [member, count] of byMember) {
    const share = count / assigned.length;
    if (share > threshold) {
      out.push({
        code: 'bus_factor',
        severity: share >= 0.6 ? 'high' : 'medium',
        title: 'Single-person dependency (bus factor)',
        detail: `${member} owns ${count}/${assigned.length} assigned tasks (${Math.round(share * 100)}%) — losing them stalls a large share of the plan.`,
      });
    }
  }
  return out;
}

export interface LatentRiskInput {
  band_metrics: BandMetric[];
  benchmark: { insufficient_data: boolean; cohort_project_type?: string };
  capacity: {
    bottleneck: {
      role: string;
      projected_busy_rate_pct: number | null;
      peak_month: string | null;
    } | null;
  };
  tasks: { task_id: string; assignee_id: string | null }[];
}

/**
 * Weighted plan-riskiness score (0–100, higher = riskier) — a graded alternative to a
 * binary verdict. Each dimension contributes its weight scaled by RAG severity
 * (Red = full, Yellow = half, Green = 0); latent advisory risks add a capped bonus so a
 * fully-Green plan can still register non-zero risk. Bands mirror the RAG language.
 */
const RISK_WEIGHTS: Record<string, number> = {
  Compliance: 0.12,
  Resource: 0.2,
  'Timeline/Dependency': 0.2,
  THI: 0.1,
  Benchmark: 0.13,
  Risk: 0.25,
};
const LATENT_POINTS: Record<RiskSeverity, number> = { high: 8, medium: 5, low: 2 };

export interface RiskScore {
  score: number; // 0–100, higher = riskier
  band: RagStatus;
  drivers: string[]; // human-readable top contributors
}

export function computeRiskScore(input: {
  pillars: { dimension: string; rag: RagStatus }[];
  latent_risks: LatentRisk[];
}): RiskScore {
  const severity = (rag: RagStatus) => (rag === 'Red' ? 1 : rag === 'Yellow' ? 0.5 : 0);

  const contributions = input.pillars
    .map((p) => ({
      dimension: p.dimension,
      rag: p.rag,
      points: (RISK_WEIGHTS[p.dimension] ?? 0) * severity(p.rag) * 100,
    }))
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points);

  const pillarScore = contributions.reduce((sum, c) => sum + c.points, 0);
  const latentBonus = input.latent_risks.reduce((sum, r) => sum + LATENT_POINTS[r.severity], 0);
  const score = Math.round(Math.min(100, pillarScore + latentBonus));

  const band: RagStatus = score >= 50 ? 'Red' : score >= 25 ? 'Yellow' : 'Green';
  const drivers = contributions.map((c) => `${c.dimension} (${c.rag})`);
  if (latentBonus > 0) drivers.push(`${input.latent_risks.length} latent risk(s)`);

  return { score, band, drivers };
}

/** Run every latent-risk detector and collect the advisory risks. */
export function scanLatentRisks(input: LatentRiskInput): LatentRisk[] {
  const risks: LatentRisk[] = [];
  risks.push(...detectFragileGreen(input.band_metrics));
  const noCohort = detectNoCohort(input.benchmark);
  if (noCohort) risks.push(noCohort);
  const nearFull = detectCapacityNearFull(input.capacity.bottleneck);
  if (nearFull) risks.push(nearFull);
  risks.push(...detectBusFactor(input.tasks));
  return risks;
}
