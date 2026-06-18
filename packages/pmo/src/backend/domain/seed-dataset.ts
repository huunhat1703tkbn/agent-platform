import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Shape of the bundled fixture (one array per dataset sheet). */
export interface PmoDataset {
  ds01_tasks: Record<string, unknown>[];
  ds02_template: Record<string, unknown>[];
  ds03_alloc: Record<string, unknown>[];
  ds04_velocity: Record<string, unknown>[];
  ds05_history: Record<string, unknown>[];
  ds06_section_check: Record<string, unknown>[];
  ds07_summary: Record<string, unknown>[];
  ds08_capacity: Record<string, unknown>[];
  ref_member: Record<string, unknown>[];
  ref_project: Record<string, unknown>[];
  kpi_norms: Record<string, unknown>[];
}

/** Load the dataset committed alongside the module (PMO-01 mock data → JSON). */
export function loadBundledDataset(): PmoDataset {
  const path = resolve(__dirname, '../../../seed-data/pmo01.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as PmoDataset;
}

export interface SeedResult {
  counts: Record<string, number>;
}

// Boolean columns that are NOT NULL — coerce null/undefined → false.
const BOOL_DEFAULTS: Record<string, string[]> = {
  ds01_tasks: ['milestone_flag'],
  ds02_template: ['required'],
  ds05_history: ['is_outlier'],
  ref_project: ['is_historical'],
};

function withTenant(
  rows: Record<string, unknown>[],
  tenantId: string,
  boolCols: string[],
): Record<string, unknown>[] {
  return rows.map((r) => {
    const row: Record<string, unknown> = { ...r, tenant_id: tenantId };
    for (const c of boolCols) row[c] = r[c] === true;
    return row;
  });
}

/**
 * Idempotent, tenant-scoped load of the PMO-01 dataset into the `pmo` schema.
 * Delete-then-insert per tenant so re-runs reflect the latest fixture exactly.
 * (Note: `review_report` is agent output, never seeded — left untouched.)
 */
export async function seedPmoDataset(input: {
  tenantId: string;
  dataset?: PmoDataset;
}): Promise<SeedResult> {
  const ds = input.dataset ?? loadBundledDataset();
  const { tenantId } = input;
  const counts: Record<string, number> = {};

  // (schema table, dataset key) pairs, ordered ref-first for readability.
  const tables = [
    [t.refMember, 'ref_member'],
    [t.refProject, 'ref_project'],
    [t.kpiNorms, 'kpi_norms'],
    [t.ds02Template, 'ds02_template'],
    [t.ds01Tasks, 'ds01_tasks'],
    [t.ds03Alloc, 'ds03_alloc'],
    [t.ds04Velocity, 'ds04_velocity'],
    [t.ds05History, 'ds05_history'],
    [t.ds06SectionCheck, 'ds06_section_check'],
    [t.ds07Summary, 'ds07_summary'],
    [t.ds08Capacity, 'ds08_capacity'],
  ] as const;

  await pmoDb().transaction(async (tx) => {
    for (const [table, key] of tables) {
      const rows = withTenant(
        (ds[key as keyof PmoDataset] ?? []) as Record<string, unknown>[],
        tenantId,
        BOOL_DEFAULTS[key] ?? [],
      );
      // biome-ignore lint/suspicious/noExplicitAny: generic bulk seed across heterogeneous tables
      await tx.delete(table as any).where(eq((table as any).tenant_id, tenantId));
      if (rows.length > 0) {
        // biome-ignore lint/suspicious/noExplicitAny: generic bulk seed across heterogeneous tables
        await tx.insert(table as any).values(rows as any);
      }
      counts[key] = rows.length;
    }
  });

  return { counts };
}
