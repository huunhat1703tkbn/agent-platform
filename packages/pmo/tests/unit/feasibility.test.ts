import { describe, expect, it } from 'vitest';
import { thiFromTasks } from '../../src/backend/domain/feasibility.ts';

describe('thiFromTasks (THI = Testing-phase effort / total effort)', () => {
  it('PLAN-002 shape: (E06 35 + E08 30) / 426 ≈ 15.3%', () => {
    const tasks = [
      { phase: 'Development', effort_days: 110 },
      { phase: 'Development', effort_days: 70 },
      { phase: 'Testing', effort_days: 35 }, // model validation testing
      { phase: 'Testing', effort_days: 30 }, // e2e acceptance testing (non-dev)
      { phase: 'Design', effort_days: 30 },
      { phase: 'Deployment', effort_days: 26 },
      { phase: 'Development', effort_days: 55 },
      { phase: 'Discovery', effort_days: 12 },
      { phase: 'Development', effort_days: 30 },
      { phase: 'Deployment', effort_days: 28 },
    ];
    expect(thiFromTasks(tasks)).toBe(15.3); // (65/426)*100 = 15.258 → rounded to 1 dp
  });

  it('counts only Testing-phase effort in the numerator', () => {
    expect(
      thiFromTasks([
        { phase: 'Testing', effort_days: 25 },
        { phase: 'Development', effort_days: 75 },
      ]),
    ).toBeCloseTo(25, 5);
  });

  it('treats null effort as 0', () => {
    expect(
      thiFromTasks([
        { phase: 'Testing', effort_days: null },
        { phase: 'Development', effort_days: 100 },
      ]),
    ).toBe(0);
  });

  it('returns null when there is no effort (cannot divide)', () => {
    expect(thiFromTasks([])).toBeNull();
    expect(thiFromTasks([{ phase: 'Testing', effort_days: 0 }])).toBeNull();
  });
});
