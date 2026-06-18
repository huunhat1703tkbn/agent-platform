// DTOs mirror @seta/pmo's ReviewReport (kept local so the web bundle never imports the
// backend package). Shapes track docs/projectplanguard/05-feasibility-rules-and-ds07.md §6.

export type Rag = 'Green' | 'Yellow' | 'Red';
export type FeasibilityStatus = 'Feasible (Green)' | 'Needs review (Yellow)' | 'Not feasible (Red)';

export interface Pillar {
  dimension: string;
  rag: Rag;
  reason?: string;
}

export interface Gap {
  check_id: string;
  component_id: string;
  section_code: string | null;
  component_name: string | null;
  status: 'Weak' | 'Missing';
  severity: 'High' | 'Medium' | 'Low';
  weight: number;
  note: string | null;
}

export interface CustomSection {
  name: string;
  action: string;
  note: string | null;
}

export interface RiskWarning {
  dimension: string;
  rag: Rag;
  metric: string;
  value_pct?: number | null;
  why: string;
  evidence: { source: string; row_id: string };
}

export interface Recommendation {
  id: string;
  action: string;
  rationale: string;
  addresses: string[];
}

export interface Benchmark {
  cohort_project_type: string;
  similar_projects: string[];
  outliers_excluded: string[];
  cohort_avg_velocity_md_month: number | null;
  insufficient_data: boolean;
  velocity: {
    plan_velocity_md_month: number;
    cohort_avg_velocity_md_month: number | null;
    deviation_pct: number | null;
    rag: Rag | null;
  };
  on_time_history_pct: number | null;
  on_time_rag: Rag | null;
}

export interface ReviewReport {
  plan_id: string;
  project_id: string | null;
  project_name: string | null;
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
  gap_report: Gap[];
  custom_sections: CustomSection[];
  risk_warnings: RiskWarning[];
  benchmark: Benchmark;
  recommended_adjustments: Recommendation[];
}

export interface PlanListItem {
  plan_id: string;
  project_id: string | null;
  project_name: string | null;
  plan_set: string | null;
}

export interface IssuedReport {
  id: string;
  status: string;
  feasibility_status: string | null;
  created_at: string;
}

export interface IssueResult {
  report_id: string;
  plan_id: string;
  feasibility_status: string;
  compliance_score_pct: number;
}

const BASE = '/api/agent/v1/pmo';

export const pmoApi = {
  async listPlans(): Promise<PlanListItem[]> {
    const res = await fetch(`${BASE}/plans`, { credentials: 'include' });
    if (!res.ok) throw new Error(`list plans failed: ${res.status}`);
    const { plans } = (await res.json()) as { plans: PlanListItem[] };
    return plans;
  },

  async getReview(planId: string): Promise<{ report: ReviewReport; issued: IssuedReport | null }> {
    const res = await fetch(`${BASE}/plans/${encodeURIComponent(planId)}/review`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`get review failed: ${res.status}`);
    return res.json() as Promise<{ report: ReviewReport; issued: IssuedReport | null }>;
  },

  async issueReview(planId: string): Promise<IssueResult> {
    const res = await fetch(`${BASE}/plans/${encodeURIComponent(planId)}/review`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`issue review failed: ${res.status}`);
    return res.json() as Promise<IssueResult>;
  },
};
