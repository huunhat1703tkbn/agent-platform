import { describe, expect, it } from 'vitest';
import {
  hiringToTarget,
  scaleProjectedBusy,
  simulateRoleChange,
} from '../../src/backend/domain/whatif.ts';

describe('scaleProjectedBusy', () => {
  it('adding people lowers projected busy proportionally (H/(H+delta))', () => {
    // ML at 132%, H=4, +2 people → 132 × 4/6 = 88
    expect(scaleProjectedBusy(132, 4, 2)).toBeCloseTo(88, 0);
  });

  it('removing people raises projected busy', () => {
    expect(scaleProjectedBusy(90, 4, -2)).toBeCloseTo(180, 0); // 90 × 4/2
  });

  it('clamps effective headcount to a floor of 1 (cannot remove the whole role)', () => {
    // H=2, delta −5 → would be −3; clamp denominator to 1 → 90 × 2/1 = 180
    expect(scaleProjectedBusy(90, 2, -5)).toBeCloseTo(180, 0);
  });

  it('delta 0 leaves it unchanged', () => {
    expect(scaleProjectedBusy(100, 4, 0)).toBe(100);
  });
});

describe('hiringToTarget', () => {
  it('computes the people to add to bring projected busy to the target', () => {
    // ML 132%, H=4, target 110 → 4 × (132/110 − 1) = 0.8 → ceil 1
    expect(hiringToTarget(132, 4, 110)).toBe(1);
  });

  it('needs more people for a tighter target', () => {
    // ML 132%, H=4, target 100 → 4 × (132/100 − 1) = 1.28 → ceil 2
    expect(hiringToTarget(132, 4, 100)).toBe(2);
  });

  it('is 0 when the role is already at or under target', () => {
    expect(hiringToTarget(100, 4, 110)).toBe(0);
    expect(hiringToTarget(110, 4, 110)).toBe(0);
  });
});

describe('simulateRoleChange', () => {
  const roles = [
    { role: 'ML Engineer', projected_busy_rate_pct: 132 },
    { role: 'Backend Developer', projected_busy_rate_pct: 105 },
    { role: 'QA Engineer', projected_busy_rate_pct: 70 },
  ];
  const headcount = new Map([
    ['ML Engineer', 4],
    ['Backend Developer', 8],
    ['QA Engineer', 4],
  ]);

  it('adding ML capacity drops the ML projection and may shift the bottleneck', () => {
    const r = simulateRoleChange(roles, headcount, 'ML Engineer', 2);
    expect(r.role_found).toBe(true);
    // ML 132 × 4/6 = 88 → new bottleneck becomes Backend at 105
    expect(r.bottleneck_after?.role).toBe('Backend Developer');
    expect(r.bottleneck_after?.projected_busy_rate_pct).toBeCloseTo(105, 0);
    expect(r.resource_rag_before).toBe('Red'); // ML 132 > 120
    expect(r.resource_rag_after).toBe('Green'); // Backend 105 ≤ 110
  });

  it('flags an unknown role with the available roles for clarification', () => {
    const r = simulateRoleChange(roles, headcount, 'Wizard', 2);
    expect(r.role_found).toBe(false);
    expect(r.available_roles).toContain('ML Engineer');
  });

  it('removing people worsens the bottleneck', () => {
    const r = simulateRoleChange(roles, headcount, 'ML Engineer', -2);
    // ML 132 × 4/2 = 264 → still bottleneck, Red
    expect(r.bottleneck_after?.role).toBe('ML Engineer');
    expect(r.resource_rag_after).toBe('Red');
  });
});
