import { describe, expect, it } from 'vitest';
import { analyzeDependencyGraph, type TaskNode } from '../../src/backend/domain/dependencies.ts';

// PLAN-002 / PRJ-002 — has the E07↔E08 cycle + deploy-before-test order violation (F-1C).
const PLAN_002: TaskNode[] = [
  { task_id: 'TASK-E01', phase: 'Discovery', dependencies: '' },
  { task_id: 'TASK-E02', phase: 'Design', dependencies: 'TASK-E01' },
  { task_id: 'TASK-E03', phase: 'Development', dependencies: 'TASK-E02' },
  { task_id: 'TASK-E04', phase: 'Development', dependencies: 'TASK-E02' },
  { task_id: 'TASK-E05', phase: 'Development', dependencies: 'TASK-E03' },
  { task_id: 'TASK-E06', phase: 'Testing', dependencies: 'TASK-E04' },
  { task_id: 'TASK-E07', phase: 'Deployment', dependencies: 'TASK-E08' },
  { task_id: 'TASK-E08', phase: 'Testing', dependencies: 'TASK-E07' },
  { task_id: 'TASK-E09', phase: 'Development', dependencies: 'TASK-E04' },
  { task_id: 'TASK-E10', phase: 'Deployment', dependencies: 'TASK-E07,TASK-E08' },
];

// PLAN-001 / PRJ-001 — strictly forward phases, acyclic (F-05 baseline).
const PLAN_001: TaskNode[] = [
  { task_id: 'TASK-O01', phase: 'Discovery', dependencies: '' },
  { task_id: 'TASK-O02', phase: 'Discovery', dependencies: 'TASK-O01' },
  { task_id: 'TASK-O03', phase: 'Design', dependencies: 'TASK-O02' },
  { task_id: 'TASK-O04', phase: 'Design', dependencies: 'TASK-O02' },
  { task_id: 'TASK-O05', phase: 'Development', dependencies: 'TASK-O03' },
  { task_id: 'TASK-O06', phase: 'Development', dependencies: 'TASK-O03,TASK-O04' },
  { task_id: 'TASK-O07', phase: 'Development', dependencies: 'TASK-O03' },
  { task_id: 'TASK-O08', phase: 'Testing', dependencies: 'TASK-O05,TASK-O06' },
  { task_id: 'TASK-O09', phase: 'Testing', dependencies: 'TASK-O06,TASK-O04' },
  { task_id: 'TASK-O10', phase: 'Deployment', dependencies: 'TASK-O08,TASK-O09' },
];

describe('analyzeDependencyGraph', () => {
  it('PLAN-002: detects the TASK-E07 ↔ TASK-E08 cycle (F-1C)', () => {
    const r = analyzeDependencyGraph(PLAN_002);
    expect(r.has_cycle).toBe(true);
    const cycleMembers = new Set(r.cycles.flat());
    expect(cycleMembers.has('TASK-E07')).toBe(true);
    expect(cycleMembers.has('TASK-E08')).toBe(true);
  });

  it('PLAN-002: flags the deploy-before-test order violation (E08 depends on E07)', () => {
    const r = analyzeDependencyGraph(PLAN_002);
    const v = r.order_violations.find(
      (x) => x.task_id === 'TASK-E08' && x.depends_on === 'TASK-E07',
    );
    expect(v).toBeDefined();
    expect(v?.task_phase).toBe('Testing');
    expect(v?.dependency_phase).toBe('Deployment');
  });

  it('PLAN-002: no dangling dependency references (all IDs resolve)', () => {
    expect(analyzeDependencyGraph(PLAN_002).dangling).toHaveLength(0);
  });

  it('PLAN-001: acyclic with no order violations (F-05)', () => {
    const r = analyzeDependencyGraph(PLAN_001);
    expect(r.has_cycle).toBe(false);
    expect(r.cycles).toHaveLength(0);
    expect(r.order_violations).toHaveLength(0);
  });

  it('flags a dependency that references an unknown task', () => {
    const r = analyzeDependencyGraph([{ task_id: 'A', phase: 'Design', dependencies: 'GHOST' }]);
    expect(r.dangling).toEqual([{ task_id: 'A', missing_dependency: 'GHOST' }]);
  });
});
