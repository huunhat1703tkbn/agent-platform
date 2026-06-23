import { describe, expect, it } from 'vitest';
import {
  type HistoryFeatures,
  type PlanFeatures,
  rankSimilar,
} from '../../src/backend/domain/similarity.ts';

const plan: PlanFeatures = {
  effort_md: 200,
  duration_months: 6,
  team_size: 8,
  velocity_md_month: 33,
};

const history: HistoryFeatures[] = [
  {
    historical_project_id: 'A',
    project_type: 'X',
    effort_md: 210,
    duration_months: 6.2,
    team_size: 8,
    velocity_md_month: 34,
    outcome: 'On Time',
    is_outlier: false,
  },
  {
    historical_project_id: 'B',
    project_type: 'X',
    effort_md: 1000,
    duration_months: 24,
    team_size: 40,
    velocity_md_month: 5,
    outcome: 'Delayed',
    is_outlier: false,
  },
  {
    historical_project_id: 'C',
    project_type: 'Y',
    effort_md: 150,
    duration_months: 5,
    team_size: 6,
    velocity_md_month: 28,
    outcome: 'On Time',
    is_outlier: false,
  },
];

describe('rankSimilar', () => {
  it('ranks the closest-by-features project first', () => {
    const r = rankSimilar(plan, history, 3);
    expect(r[0]?.historical_project_id).toBe('A');
    expect(r[0]?.similarity_pct).toBeGreaterThan(r[1]?.similarity_pct ?? 100);
  });

  it('returns the outcome and same-type flag for each match', () => {
    const r = rankSimilar(plan, history, 1);
    expect(r[0]?.outcome).toBe('On Time');
    expect(r[0]?.same_type).toBe(false); // plan type unknown here → not same
  });

  it('reports the plan-vs-project deltas (how the plan differs)', () => {
    const r = rankSimilar(plan, history, 1);
    // plan duration 6 vs A 6.2 → ~ −3%
    expect(r[0]?.deltas.duration_pct).toBeLessThan(0);
    expect(r[0]?.deltas.effort_pct).toBeLessThan(0); // 200 vs 210
  });

  it('excludes outliers from the ranking', () => {
    const withOutlier: HistoryFeatures[] = [
      ...history,
      {
        historical_project_id: 'O',
        project_type: 'X',
        effort_md: 205,
        duration_months: 6.1,
        team_size: 8,
        velocity_md_month: 33,
        outcome: 'On Time',
        is_outlier: true,
      },
    ];
    const r = rankSimilar(plan, withOutlier, 5);
    expect(r.map((x) => x.historical_project_id)).not.toContain('O');
  });

  it('returns at most k matches', () => {
    expect(rankSimilar(plan, history, 2)).toHaveLength(2);
  });

  it('marks same project type when the plan type is given', () => {
    const r = rankSimilar({ ...plan, project_type: 'X' }, history, 3);
    expect(r.find((x) => x.historical_project_id === 'A')?.same_type).toBe(true);
    expect(r.find((x) => x.historical_project_id === 'C')?.same_type).toBe(false);
  });
});
