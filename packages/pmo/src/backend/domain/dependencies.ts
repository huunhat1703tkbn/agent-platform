/**
 * Dependency-logic validation (S06 — acyclic) over DS01.
 * Pure, deterministic; the contract is
 * docs/projectplanguard/05-feasibility-rules-and-ds07.md §3b.
 *
 * Builds a directed graph from each task's `dependencies` (CSV of prerequisite task_ids) and:
 *  1. Cycle detection (Tarjan SCC; any SCC of size ≥ 2, or a self-dependency, is a cycle).
 *  2. Logical-order violations — a task whose prerequisite sits in a strictly LATER phase
 *     (e.g. deploy-before-test). Phase order: Discovery < Design < Development < Testing < Deployment.
 *  3. Dangling references — a dependency id that is not a task in the plan (data-quality flag).
 */

import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';

export interface TaskNode {
  task_id: string;
  phase: string | null;
  dependencies: string | null; // CSV of prerequisite task_ids
}

export interface OrderViolation {
  task_id: string;
  depends_on: string;
  task_phase: string | null;
  dependency_phase: string | null;
}

export interface DanglingDependency {
  task_id: string;
  missing_dependency: string;
}

export interface DependencyResult {
  has_cycle: boolean;
  cycles: string[][];
  order_violations: OrderViolation[];
  dangling: DanglingDependency[];
}

const PHASE_RANK: Record<string, number> = {
  Discovery: 1,
  Design: 2,
  Development: 3,
  Testing: 4,
  Deployment: 5,
};

function parseDeps(csv: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function analyzeDependencyGraph(tasks: TaskNode[]): DependencyResult {
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const edges = new Map<string, string[]>(); // task → its prerequisites (present in the plan)
  const dangling: DanglingDependency[] = [];
  const order_violations: OrderViolation[] = [];

  for (const task of tasks) {
    const deps = parseDeps(task.dependencies);
    const resolved: string[] = [];
    for (const dep of deps) {
      const depTask = byId.get(dep);
      if (!depTask) {
        dangling.push({ task_id: task.task_id, missing_dependency: dep });
        continue;
      }
      resolved.push(dep);
      const taskRank = PHASE_RANK[task.phase ?? ''] ?? 0;
      const depRank = PHASE_RANK[depTask.phase ?? ''] ?? 0;
      if (taskRank > 0 && depRank > 0 && depRank > taskRank) {
        order_violations.push({
          task_id: task.task_id,
          depends_on: dep,
          task_phase: task.phase,
          dependency_phase: depTask.phase,
        });
      }
    }
    edges.set(task.task_id, resolved);
  }

  const cycles = findCycles(tasks, edges);
  return { has_cycle: cycles.length > 0, cycles, order_violations, dangling };
}

/** Fetch a project's DS01 tasks and validate its dependency graph. */
export async function validateDependencies(input: {
  tenantId: string;
  projectId: string;
}): Promise<DependencyResult> {
  const rows = await pmoDb()
    .select()
    .from(t.ds01Tasks)
    .where(
      and(eq(t.ds01Tasks.tenant_id, input.tenantId), eq(t.ds01Tasks.project_id, input.projectId)),
    );

  return analyzeDependencyGraph(
    rows.map((r) => ({ task_id: r.task_id, phase: r.phase, dependencies: r.dependencies })),
  );
}

/** Tarjan's SCC; an SCC with ≥2 members (or a self-loop) is a dependency cycle. */
function findCycles(tasks: TaskNode[], edges: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongConnect = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
      }
    }

    if (low.get(v) === idx.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  };

  for (const t of tasks) if (!idx.has(t.task_id)) strongConnect(t.task_id);

  const cycles: string[][] = [];
  for (const scc of sccs) {
    if (scc.length > 1) {
      cycles.push(scc);
    } else {
      const only = scc[0];
      if (only != null && (edges.get(only) ?? []).includes(only)) cycles.push(scc); // self-dependency
    }
  }
  return cycles;
}
