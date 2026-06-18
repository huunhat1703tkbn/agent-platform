import { describe, expect, it } from 'vitest';
import {
  compareVelocity,
  type HistoryRow,
  historicalVelocityMdMonth,
  selectCohort,
} from '../../src/backend/domain/benchmark.ts';

const HISTORY: HistoryRow[] = [
  // Software/Migration cohort (PLAN-001 / PRJ-001)
  {
    historical_project_id: 'PRJ-H-101',
    project_type: 'Software/Migration',
    duration_days: 240,
    total_effort_days: 180,
    is_outlier: false,
  },
  {
    historical_project_id: 'PRJ-H-102',
    project_type: 'Software/Migration',
    duration_days: 210,
    total_effort_days: 155,
    is_outlier: false,
  },
  {
    historical_project_id: 'PRJ-H-201',
    project_type: 'Software/Migration',
    duration_days: 210,
    total_effort_days: 165.3,
    is_outlier: false,
  },
  // AI/ML cohort (PLAN-002 / PRJ-002) + the tiny outlier to exclude (F-06)
  {
    historical_project_id: 'PRJ-H-103',
    project_type: 'AI/ML Platform',
    duration_days: 270,
    total_effort_days: 400,
    is_outlier: false,
  },
  {
    historical_project_id: 'PRJ-H-104',
    project_type: 'AI/ML Platform',
    duration_days: 255,
    total_effort_days: 380,
    is_outlier: false,
  },
  {
    historical_project_id: 'PRJ-H-199',
    project_type: 'AI/ML Platform',
    duration_days: 15,
    total_effort_days: 15,
    is_outlier: true,
  },
];

describe('historicalVelocityMdMonth', () => {
  it('is effort_days / (duration_days / 30)', () => {
    expect(historicalVelocityMdMonth(HISTORY[0]!)).toBeCloseTo(22.5, 3); // 180 / 8
  });
});

describe('selectCohort', () => {
  it('AI/ML: keeps H-103/H-104 and excludes the H-199 outlier (F-06)', () => {
    const c = selectCohort(HISTORY, 'AI/ML Platform');
    expect(c.similar_projects.sort()).toEqual(['PRJ-H-103', 'PRJ-H-104']);
    expect(c.outliers_excluded).toContain('PRJ-H-199');
    expect(c.cohort_avg_velocity_md_month).toBeCloseTo((400 / 9 + 380 / 8.5) / 2, 2);
  });

  it('Software/Migration: cohort avg ≈ 22.7 MD/mo (PLAN-001 baseline)', () => {
    const c = selectCohort(HISTORY, 'Software/Migration');
    expect(c.similar_projects).toHaveLength(3);
    expect(c.cohort_avg_velocity_md_month).toBeCloseTo((22.5 + 155 / 7 + 165.3 / 7) / 3, 2);
    expect(c.insufficient_data).toBe(false);
  });

  it('flags insufficient data when fewer than the minimum cohort size', () => {
    const c = selectCohort(HISTORY, 'Software/Migration', 5);
    expect(c.insufficient_data).toBe(true);
  });
});

describe('compareVelocity', () => {
  it('PLAN-001 velocity 24 vs cohort ~22.7 → small deviation, Green (F-05)', () => {
    const r = compareVelocity(24, 22.7);
    expect(r.deviation_pct).toBeCloseTo(5.73, 1);
    expect(r.rag).toBe('Green');
  });

  it('classifies a large over-estimate as optimistic (Yellow/Red)', () => {
    expect(compareVelocity(40, 22.7).rag).toBe('Red'); // +76%
    expect(compareVelocity(27, 22.7).rag).toBe('Yellow'); // +19%
  });

  it('returns null rag when there is no cohort to compare against', () => {
    expect(compareVelocity(24, null).rag).toBeNull();
  });
});
