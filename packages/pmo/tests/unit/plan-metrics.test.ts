import { describe, expect, it } from 'vitest';
import {
  cohortOnTimeFromSchedule,
  monthsSpan,
  planVelocityMdMonth,
  scheduleAdherence,
  scheduleRealism,
  sumEffortMd,
} from '../../src/backend/domain/plan-metrics.ts';

describe('sumEffortMd', () => {
  it('sums task effort, treating null effort as 0', () => {
    expect(sumEffortMd([{ effort_days: 8 }, { effort_days: 12.5 }, { effort_days: null }])).toBe(
      20.5,
    );
  });

  it('is 0 for an empty plan', () => {
    expect(sumEffortMd([])).toBe(0);
  });
});

describe('planVelocityMdMonth', () => {
  it('is effort_md / planned duration_months (PLAN-002: 426 / 9 ≈ 47.3)', () => {
    expect(planVelocityMdMonth(426, 9)).toBeCloseTo(47.33, 2);
  });

  it('matches the DS07 baselines (PLAN-001 168/7=24, PLAN-104 140/5=28)', () => {
    expect(planVelocityMdMonth(168, 7)).toBe(24);
    expect(planVelocityMdMonth(140, 5)).toBe(28);
  });

  it('returns null when the planned duration is missing or non-positive', () => {
    expect(planVelocityMdMonth(426, null)).toBeNull();
    expect(planVelocityMdMonth(426, 0)).toBeNull();
  });
});

describe('monthsSpan (max end − min start, ÷ 30)', () => {
  it('is (max end − min start) in 30-day months', () => {
    // 2026-04-06 → 2026-10-16 = 193 days ⇒ 193/30 ≈ 6.43 months
    expect(monthsSpan(['2026-04-06', '2026-05-15', '2026-10-16'])).toBeCloseTo(193 / 30, 5);
  });
  it('takes the earliest start and latest end across many dates (185-day span)', () => {
    // 2026-05-19 → 2026-11-20 = 185 days ⇒ 185/30
    expect(monthsSpan(['2026-05-19', '2026-06-05', '2026-11-20', null])).toBeCloseTo(185 / 30, 5);
  });
  it('is null when there are no usable dates', () => {
    expect(monthsSpan([null, null])).toBeNull();
  });
});

describe('scheduleRealism', () => {
  it('flags when the task span exceeds the planned duration (PLAN-104 shape: 7.3 vs 5)', () => {
    const r = scheduleRealism(7.3, 5);
    expect(r.span_exceeds_planned).toBe(true);
    expect(r.over_run_pct).toBeCloseTo(46, 0);
  });
  it('does not flag when tasks fit inside the planned duration (PLAN-002: 7 vs 9)', () => {
    const r = scheduleRealism(7, 9);
    expect(r.span_exceeds_planned).toBe(false);
    expect(r.over_run_pct).toBeLessThan(0);
  });
  it('returns null/false when planned duration is missing', () => {
    expect(scheduleRealism(7, null)).toEqual({ over_run_pct: null, span_exceeds_planned: false });
  });
});

describe('scheduleAdherence (min(1, planned/actual))', () => {
  it('is 1.0 when delivered on or ahead of schedule', () => {
    expect(scheduleAdherence(210, 210)).toBe(1); // on time
    expect(scheduleAdherence(200, 210)).toBe(1); // early → capped at 1
  });
  it('is planned/actual when late (240 actual vs 210 planned → 0.875)', () => {
    expect(scheduleAdherence(240, 210)).toBeCloseTo(0.875, 5);
  });
  it('is null when either duration is missing or non-positive', () => {
    expect(scheduleAdherence(null, 210)).toBeNull();
    expect(scheduleAdherence(240, 0)).toBeNull();
  });
});

describe('cohortOnTimeFromSchedule (mean schedule adherence × 100)', () => {
  it('PLAN-001 Software/Migration cohort → 98.4% (one 7%-late + three on-time)', () => {
    const rows = [
      { duration_days: 240, planned_duration_days: 225 }, // 0.9375
      { duration_days: 210, planned_duration_days: 210 }, // 1.0
      { duration_days: 210, planned_duration_days: 210 }, // 1.0
      { duration_days: 150, planned_duration_days: 150 }, // 1.0
    ];
    expect(cohortOnTimeFromSchedule(rows)).toBeCloseTo(98.4, 1);
  });
  it('is null for an empty cohort', () => {
    expect(cohortOnTimeFromSchedule([])).toBeNull();
  });
});
