/**
 * Similar-project retrieval over the historical benchmark set (DS05) using DETERMINISTIC
 * feature similarity — NOT LLM embeddings. With a small, fully-structured cohort the
 * honest, gradeable approach is a normalised feature vector (effort, duration, team size,
 * velocity) + distance, returning the closest past projects and their OUTCOMES so the
 * agent can say "this plan resembles PRJ-H-101 (87%), which delivered late; your timeline
 * is 30% shorter." (pgvector/text embeddings are a scale-path for thousands of rows.)
 *
 * Contract background: docs/projectplanguard/05-feasibility-rules-and-ds07.md §4.
 */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { historicalVelocityMdMonth } from './benchmark.ts';
import { computePlanVelocity } from './plan-metrics.ts';

const FEATURES = ['effort_md', 'duration_months', 'team_size', 'velocity_md_month'] as const;
type Feature = (typeof FEATURES)[number];

export interface PlanFeatures {
  project_type?: string | null;
  effort_md: number | null;
  duration_months: number | null;
  team_size: number | null;
  velocity_md_month: number | null;
}

export interface HistoryFeatures extends PlanFeatures {
  historical_project_id: string;
  project_type: string | null;
  outcome: string | null;
  is_outlier: boolean;
}

export interface SimilarProject {
  historical_project_id: string;
  project_type: string | null;
  similarity_pct: number;
  outcome: string | null;
  same_type: boolean;
  deltas: {
    effort_pct: number | null;
    duration_pct: number | null;
    team_pct: number | null;
    velocity_pct: number | null;
  };
}

function pctDelta(planVal: number | null, projVal: number | null): number | null {
  if (planVal == null || projVal == null || projVal === 0) return null;
  return Math.round(((planVal - projVal) / projVal) * 1000) / 10;
}

/**
 * Rank historical projects by feature similarity to the plan. Each feature is min-max
 * normalised across the plan + cohort (so disparate scales — man-days vs months — weigh
 * equally), then similarity = 1 − euclidean/√(dims used). Outliers are excluded.
 */
export function rankSimilar(
  plan: PlanFeatures,
  history: HistoryFeatures[],
  k: number,
): SimilarProject[] {
  const cohort = history.filter((h) => !h.is_outlier);
  if (cohort.length === 0) return [];

  // Min-max range per feature over plan + cohort (skip features the plan lacks).
  const usable: Feature[] = FEATURES.filter((f) => plan[f] != null);
  const range = new Map<Feature, { min: number; max: number }>();
  for (const f of usable) {
    const vals = [
      plan[f] as number,
      ...cohort.map((h) => h[f]).filter((v): v is number => v != null),
    ];
    range.set(f, { min: Math.min(...vals), max: Math.max(...vals) });
  }

  const norm = (f: Feature, v: number): number => {
    const r = range.get(f);
    if (!r || r.max === r.min) return 0.5;
    return (v - r.min) / (r.max - r.min);
  };

  const scored = cohort.map((h) => {
    const dims = usable.filter((f) => h[f] != null);
    let sumSq = 0;
    for (const f of dims) sumSq += (norm(f, plan[f] as number) - norm(f, h[f] as number)) ** 2;
    const dist = dims.length > 0 ? Math.sqrt(sumSq) / Math.sqrt(dims.length) : 1;
    const similarity_pct = Math.round((1 - dist) * 1000) / 10;
    return {
      historical_project_id: h.historical_project_id,
      project_type: h.project_type,
      similarity_pct,
      outcome: h.outcome,
      same_type: plan.project_type != null && plan.project_type === h.project_type,
      deltas: {
        effort_pct: pctDelta(plan.effort_md, h.effort_md),
        duration_pct: pctDelta(plan.duration_months, h.duration_months),
        team_pct: pctDelta(plan.team_size, h.team_size),
        velocity_pct: pctDelta(plan.velocity_md_month, h.velocity_md_month),
      },
    };
  });

  scored.sort((a, b) => b.similarity_pct - a.similarity_pct);
  return scored.slice(0, k);
}

export interface SimilarProjectsResult {
  plan_id: string;
  plan: PlanFeatures;
  similar: SimilarProject[];
}

/**
 * Fetch the plan's features (DS01-derived effort/duration/velocity + DS07 team/type) and
 * the historical cohort (DS05), and return the top-K most similar past projects.
 */
export async function findSimilarProjects(input: {
  tenantId: string;
  planId: string;
  k?: number;
}): Promise<SimilarProjectsResult | null> {
  const { tenantId, planId } = input;
  const db = pmoDb();
  const [summary] = await db
    .select()
    .from(t.ds07Summary)
    .where(and(eq(t.ds07Summary.tenant_id, tenantId), eq(t.ds07Summary.plan_id, planId)))
    .limit(1);
  if (!summary) return null;

  const projectId = summary.project_id ?? null;
  const [project] = projectId
    ? await db
        .select()
        .from(t.refProject)
        .where(and(eq(t.refProject.tenant_id, tenantId), eq(t.refProject.project_id, projectId)))
        .limit(1)
    : [];

  const velocity = await computePlanVelocity({ tenantId, planId });
  const plan: PlanFeatures = {
    project_type: project?.project_type ?? null,
    effort_md: velocity.effort_md,
    duration_months: velocity.duration_months,
    team_size: summary.team_size,
    velocity_md_month: velocity.velocity_md_month,
  };

  const rows = await db.select().from(t.ds05History).where(eq(t.ds05History.tenant_id, tenantId));
  const history: HistoryFeatures[] = rows.map((r) => ({
    historical_project_id: r.historical_project_id,
    project_type: r.project_type,
    effort_md: r.total_effort_days,
    duration_months: r.duration_days != null ? r.duration_days / 30 : null,
    team_size: r.team_size,
    velocity_md_month: historicalVelocityMdMonth({
      historical_project_id: r.historical_project_id,
      project_type: r.project_type,
      duration_days: r.duration_days,
      total_effort_days: r.total_effort_days,
      is_outlier: r.is_outlier,
    }),
    outcome: r.final_outcome,
    is_outlier: r.is_outlier,
  }));

  return { plan_id: planId, plan, similar: rankSimilar(plan, history, input.k ?? 3) };
}
