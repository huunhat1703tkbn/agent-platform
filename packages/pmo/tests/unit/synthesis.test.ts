import { describe, expect, it } from 'vitest';
import {
  detectCrossDimensionConflict,
  type Pillar,
  rollupFeasibilityStatus,
} from '../../src/backend/domain/synthesis.ts';

const p = (dimension: string, rag: Pillar['rag']): Pillar => ({ dimension, rag });

describe('rollupFeasibilityStatus (doc 05 §5)', () => {
  it('any Red pillar → Not feasible (Red)', () => {
    expect(rollupFeasibilityStatus([p('Resource', 'Red'), p('THI', 'Green')], false)).toBe(
      'Not feasible (Red)',
    );
  });

  it('a Yellow pillar (no Red) → Needs review (Yellow)', () => {
    expect(rollupFeasibilityStatus([p('Benchmark', 'Yellow'), p('THI', 'Green')], false)).toBe(
      'Needs review (Yellow)',
    );
  });

  it('all Green → Feasible (Green)', () => {
    expect(rollupFeasibilityStatus([p('Resource', 'Green'), p('THI', 'Green')], false)).toBe(
      'Feasible (Green)',
    );
  });

  it('all Green but a cross-dimension conflict → forced to Needs review (Yellow)', () => {
    expect(rollupFeasibilityStatus([p('Resource', 'Green'), p('THI', 'Green')], true)).toBe(
      'Needs review (Yellow)',
    );
  });
});

describe('detectCrossDimensionConflict (the differentiator: compliant yet infeasible)', () => {
  it('high compliance but a non-green feasibility pillar → conflict', () => {
    const r = detectCrossDimensionConflict(92, [
      p('Compliance', 'Green'),
      p('Benchmark', 'Yellow'),
    ]);
    expect(r.conflict).toBe(true);
    expect(r.explanation).toMatch(/compli/i);
  });

  it('low compliance with red pillars → no "hidden" conflict (it is plainly infeasible)', () => {
    const r = detectCrossDimensionConflict(71.5, [p('Resource', 'Red'), p('THI', 'Red')]);
    expect(r.conflict).toBe(false);
  });

  it('high compliance and all feasibility pillars green → no conflict', () => {
    const r = detectCrossDimensionConflict(100, [p('Resource', 'Green'), p('THI', 'Green')]);
    expect(r.conflict).toBe(false);
  });
});
