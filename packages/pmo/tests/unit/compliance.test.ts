import { describe, expect, it } from 'vitest';
import {
  type SectionCheckRow,
  scoreComplianceFromRows,
  type TemplateRow,
} from '../../src/backend/domain/compliance.ts';

// PMO standard template (DS02): 8 required components, weights sum to 1.0.
const TEMPLATE: TemplateRow[] = [
  { component_id: 'COMP-001', section_code: 'S01', component_name: 'Scope', weight: 0.12 },
  { component_id: 'COMP-002', section_code: 'S02', component_name: 'Objectives', weight: 0.1 },
  { component_id: 'COMP-003', section_code: 'S03', component_name: 'Milestones', weight: 0.12 },
  { component_id: 'COMP-004', section_code: 'S04', component_name: 'WBS_Effort', weight: 0.13 },
  { component_id: 'COMP-005', section_code: 'S05', component_name: 'Resource_Plan', weight: 0.13 },
  { component_id: 'COMP-006', section_code: 'S06', component_name: 'Dependencies', weight: 0.12 },
  { component_id: 'COMP-007', section_code: 'S07', component_name: 'Risk_RAID', weight: 0.16 },
  {
    component_id: 'COMP-008',
    section_code: 'S08',
    component_name: 'Acceptance_Criteria',
    weight: 0.12,
  },
];

function check(
  component_id: string | null,
  status: string,
  extra: Partial<SectionCheckRow> = {},
): SectionCheckRow {
  return {
    check_id: `CHK-${component_id ?? 'X'}`,
    component_id,
    custom_name: null,
    status,
    note: null,
    ...extra,
  };
}

describe('scoreComplianceFromRows', () => {
  it('PLAN-001: all 8 sections Complete → 100% and no gaps (F-05)', () => {
    const checks = TEMPLATE.map((c) => check(c.component_id, 'Complete'));
    const result = scoreComplianceFromRows(TEMPLATE, checks);
    expect(result.score_pct).toBeCloseTo(100, 5);
    expect(result.gaps).toHaveLength(0);
    expect(result.custom_sections).toHaveLength(0);
    expect(result.risk_register_missing).toBe(false);
  });

  it('PLAN-002: Weak S05/S08, Missing S07, Custom EVM → 71.5% (F-01,F-02,F-04)', () => {
    const checks: SectionCheckRow[] = [
      check('COMP-001', 'Complete'),
      check('COMP-002', 'Complete'),
      check('COMP-003', 'Complete'),
      check('COMP-004', 'Complete'),
      check('COMP-005', 'Weak'),
      check('COMP-006', 'Complete'),
      check('COMP-007', 'Missing'),
      check('COMP-008', 'Weak'),
      check(null, 'Custom', { custom_name: 'EVM_Cost_Tracking', check_id: 'CHK-017' }),
    ];
    const result = scoreComplianceFromRows(TEMPLATE, checks);

    // 0.12+0.10+0.12+0.13 + 0.5*0.13 + 0.12 + 0 + 0.5*0.12 = 0.715
    expect(result.score_pct).toBeCloseTo(71.5, 5);

    // F-01: Risk Register (S07) missing → High gap + Risk pillar default flag.
    expect(result.risk_register_missing).toBe(true);
    const s07 = result.gaps.find((g) => g.component_id === 'COMP-007');
    expect(s07).toMatchObject({ status: 'Missing', severity: 'High' });

    // F-02: Resource_Plan & Acceptance_Criteria weak → Medium gaps.
    const weakGaps = result.gaps.filter((g) => g.status === 'Weak');
    expect(weakGaps.map((g) => g.component_id).sort()).toEqual(['COMP-005', 'COMP-008']);
    expect(weakGaps.every((g) => g.severity === 'Medium')).toBe(true);

    // F-04: custom section is flagged for review, NEVER a gap.
    expect(result.custom_sections).toHaveLength(1);
    expect(result.custom_sections[0]).toMatchObject({ name: 'EVM_Cost_Tracking' });
    expect(result.gaps.some((g) => g.custom_name === 'EVM_Cost_Tracking')).toBe(false);
  });
});
