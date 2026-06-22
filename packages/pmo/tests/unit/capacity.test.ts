import { describe, expect, it } from 'vitest';
import {
  assessRoleCapacity,
  canonicalRole,
  spreadEffortByMonth,
} from '../../src/backend/domain/capacity.ts';

describe('canonicalRole', () => {
  it('maps DS03 abbreviations to DS08 titles', () => {
    expect(canonicalRole('ML')).toBe('ML Engineer');
    expect(canonicalRole('BE')).toBe('Backend Developer');
  });
  it('passes through already-canonical / unknown roles', () => {
    expect(canonicalRole('DevOps')).toBe('DevOps');
    expect(canonicalRole('Wizard')).toBe('Wizard');
    expect(canonicalRole(null)).toBeNull();
  });
});

describe('spreadEffortByMonth', () => {
  it('keeps all effort within a single month', () => {
    const m = spreadEffortByMonth({
      effort_days: 10,
      start_date: '2026-04-01',
      end_date: '2026-04-20',
    });
    expect(m.get('2026-04')).toBeCloseTo(10, 6);
  });

  it('splits effort across months proportional to days', () => {
    // 30 effort over Apr 16–May 15 → ~15 days each month → ~15 MD each.
    const m = spreadEffortByMonth({
      effort_days: 30,
      start_date: '2026-04-16',
      end_date: '2026-05-15',
    });
    const apr = m.get('2026-04') ?? 0;
    const may = m.get('2026-05') ?? 0;
    expect(apr + may).toBeCloseTo(30, 6);
    expect(apr).toBeGreaterThan(10);
    expect(may).toBeGreaterThan(10);
  });

  it('returns empty for zero effort or invalid dates', () => {
    expect(
      spreadEffortByMonth({ effort_days: 0, start_date: '2026-04-01', end_date: '2026-04-10' })
        .size,
    ).toBe(0);
    expect(spreadEffortByMonth({ effort_days: 10, start_date: null, end_date: null }).size).toBe(0);
    expect(
      spreadEffortByMonth({ effort_days: 10, start_date: '2026-04-10', end_date: '2026-04-01' })
        .size,
    ).toBe(0);
  });
});

describe('assessRoleCapacity', () => {
  const capacity = new Map([
    [
      'ML Engineer',
      { role: 'ML Engineer', capacity_md_month: 88, available_md_month: 13, busy_rate_pct: 85 },
    ],
    [
      'DevOps',
      { role: 'DevOps', capacity_md_month: 66, available_md_month: 20, busy_rate_pct: 70 },
    ],
  ]);

  it('computes peak-month demand, projected busy rate and spare overrun per role', () => {
    const tasks = [
      // 44 MD of ML work entirely in June → demand 44 vs spare 13 → exceeds, projected 85+50=135.
      { assignee_id: 'M1', effort_days: 44, start_date: '2026-06-01', end_date: '2026-06-30' },
      { assignee_id: 'M2', effort_days: 10, start_date: '2026-06-01', end_date: '2026-06-30' },
    ];
    const roleByMember = new Map<string, string | null>([
      ['M1', 'ML'],
      ['M2', 'DevOps'],
    ]);
    const { roles } = assessRoleCapacity(tasks, roleByMember, capacity);
    const ml = roles.find((r) => r.role === 'ML Engineer');
    expect(ml?.peak_demand_md).toBeCloseTo(44, 6);
    expect(ml?.exceeds_spare).toBe(true); // 44 > 13 spare
    expect(ml?.projected_busy_rate_pct).toBeCloseTo(85 + (44 / 88) * 100, 4); // 135
    expect(ml?.rag).toBe('Red');
    // sorted worst-first → ML is the bottleneck
    expect(roles[0]?.role).toBe('ML Engineer');
  });

  it('flags roles with no DS08 capacity row as unmapped', () => {
    const tasks = [
      { assignee_id: 'X1', effort_days: 10, start_date: '2026-06-01', end_date: '2026-06-30' },
    ];
    const { roles, unmapped_roles } = assessRoleCapacity(
      tasks,
      new Map<string, string | null>([['X1', 'Astrologer']]),
      capacity,
    );
    expect(unmapped_roles).toContain('Astrologer');
    expect(roles.find((r) => r.role === 'Astrologer')?.rag).toBeNull();
  });
});
