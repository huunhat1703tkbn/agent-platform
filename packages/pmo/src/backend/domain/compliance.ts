/**
 * Compliance scoring — DS02 (PMO standard template) × DS06 (per-plan section check).
 * Pure, deterministic; the contract is
 * docs/projectplanguard/05-feasibility-rules-and-ds07.md §2.
 *
 * Per-section credit: Complete → 1.0×weight, Weak → 0.5×weight (Medium gap),
 * Missing → 0 (gap, severity from weight/role), Custom → excluded from the score and
 * flagged for PMO review (NEVER a gap). Score is normalised by the summed weight of the
 * required components in scope (the 8 required weights sum to 1.0).
 *
 * Special rule: if S07 Risk_RAID is Missing, the Risk feasibility pillar defaults to Red
 * (Answer_Key F-01) — surfaced here via `risk_register_missing`.
 */

import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';

export interface TemplateRow {
  component_id: string;
  section_code: string | null;
  component_name: string | null;
  weight: number | null;
}

export interface SectionCheckRow {
  check_id: string;
  component_id: string | null; // NULL when the section is Custom
  custom_name: string | null;
  status: string | null; // Complete | Weak | Missing | Custom
  note: string | null;
}

export type GapSeverity = 'High' | 'Medium' | 'Low';

export interface ComplianceGap {
  check_id: string;
  component_id: string;
  section_code: string | null;
  component_name: string | null;
  status: 'Weak' | 'Missing';
  severity: GapSeverity;
  weight: number;
  custom_name: null;
  note: string | null;
  evidence: { source: 'DS06'; row_id: string };
}

export interface CustomSection {
  name: string;
  action: 'flag_for_pmo_review';
  evidence: { source: 'DS06'; row_id: string };
  note: string | null;
}

export interface ComplianceResult {
  score_pct: number;
  gaps: ComplianceGap[];
  custom_sections: CustomSection[];
  risk_register_missing: boolean;
}

const CREDIT: Record<string, number> = { Complete: 1.0, Weak: 0.5, Missing: 0, Custom: 0 };

// The Risk_RAID component (S07) carries the highest weight and gates the Risk pillar.
const RISK_SECTION = 'S07';

/** A Missing component is High when it is a high-weight pillar (≥0.15) or the Risk section. */
function missingSeverity(weight: number, sectionCode: string | null): GapSeverity {
  if (sectionCode === RISK_SECTION || weight >= 0.15) return 'High';
  if (weight >= 0.1) return 'Medium';
  return 'Low';
}

export function scoreComplianceFromRows(
  template: TemplateRow[],
  checks: SectionCheckRow[],
): ComplianceResult {
  const checkByComponent = new Map(
    checks.filter((c) => c.component_id != null).map((c) => [c.component_id as string, c]),
  );

  const gaps: ComplianceGap[] = [];
  const custom_sections: CustomSection[] = [];
  let risk_register_missing = false;

  // Custom sections (component_id NULL, status Custom): excluded from scoring, flagged only.
  for (const chk of checks) {
    if (chk.component_id == null && (chk.status === 'Custom' || chk.custom_name)) {
      custom_sections.push({
        name: chk.custom_name ?? 'Custom section',
        action: 'flag_for_pmo_review',
        evidence: { source: 'DS06', row_id: chk.check_id },
        note: chk.note,
      });
    }
  }

  // Score over the required components in scope (denominator = Σ their weights).
  let creditSum = 0;
  let weightSum = 0;
  for (const comp of template) {
    const weight = comp.weight ?? 0;
    weightSum += weight;
    const chk = checkByComponent.get(comp.component_id);
    const status = chk?.status ?? 'Missing';
    creditSum += (CREDIT[status] ?? 0) * weight;

    if (status === 'Weak' || status === 'Missing') {
      const severity = status === 'Weak' ? 'Medium' : missingSeverity(weight, comp.section_code);
      gaps.push({
        check_id: chk?.check_id ?? `MISSING-${comp.component_id}`,
        component_id: comp.component_id,
        section_code: comp.section_code,
        component_name: comp.component_name,
        status,
        severity,
        weight,
        custom_name: null,
        note: chk?.note ?? null,
        evidence: { source: 'DS06', row_id: chk?.check_id ?? `MISSING-${comp.component_id}` },
      });
      if (comp.section_code === RISK_SECTION && status === 'Missing') risk_register_missing = true;
    }
  }

  const score_pct = weightSum > 0 ? (creditSum / weightSum) * 100 : 0;
  return { score_pct, gaps, custom_sections, risk_register_missing };
}

/** Fetch DS02 (template) + DS06 (plan section check) and score compliance for a plan. */
export async function scoreCompliance(input: {
  tenantId: string;
  planId: string;
}): Promise<ComplianceResult> {
  const db = pmoDb();
  const [template, checks] = await Promise.all([
    db.select().from(t.ds02Template).where(eq(t.ds02Template.tenant_id, input.tenantId)),
    db
      .select()
      .from(t.ds06SectionCheck)
      .where(
        and(
          eq(t.ds06SectionCheck.tenant_id, input.tenantId),
          eq(t.ds06SectionCheck.plan_id, input.planId),
        ),
      ),
  ]);

  return scoreComplianceFromRows(
    template.map((r) => ({
      component_id: r.component_id,
      section_code: r.section_code,
      component_name: r.component_name,
      weight: r.weight,
    })),
    checks.map((r) => ({
      check_id: r.check_id,
      component_id: r.component_id,
      custom_name: r.custom_name,
      status: r.status,
      note: r.note,
    })),
  );
}
