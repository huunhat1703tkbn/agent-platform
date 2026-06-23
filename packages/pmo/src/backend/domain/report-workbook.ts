/**
 * Render a deterministic DS07 ReviewReport into a multi-sheet Excel workbook — the
 * deliverable a PMO / Delivery Director downloads, signs and forwards. Pure presentation
 * over the existing report payload (no recomputation): Summary + Pillars + Gaps + Risk
 * Warnings + Latent Risks + Recommendations + Capacity.
 */
import ExcelJS from 'exceljs';
import type { ReviewReport } from './synthesis.ts';

function header(ws: ExcelJS.Worksheet, cols: string[]): void {
  const row = ws.addRow(cols);
  row.font = { bold: true };
}

function num(n: number | null | undefined, digits = 0): string {
  return n == null ? '—' : `${Math.round(n * 10 ** digits) / 10 ** digits}`;
}

/** Build the DS07 review workbook and return it as an .xlsx buffer. */
export async function reportToWorkbookBuffer(report: ReviewReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProjectPlanGuard';

  // ── Summary ──────────────────────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 28 }, { width: 70 }];
  const kv = (k: string, v: string) => summary.addRow([k, v]);
  kv('Plan', report.plan_id);
  kv('Project', report.project_name ?? '—');
  kv('Verdict', report.feasibility_status);
  kv('Reason', report.feasibility_reason);
  kv('Risk Score', `${report.risk_score.score}/100 (${report.risk_score.band})`);
  kv('Risk drivers', report.risk_score.drivers.join('; ') || '—');
  kv('Compliance', `${num(report.compliance_score_pct, 1)}%`);
  kv('Peak role busy (DS07)', `${num(report.peak_role_busy_rate_pct)}%`);
  kv('THI', `${num(report.thi_pct, 1)}%`);
  kv('Effort (MD)', num(report.effort_md));
  kv('Duration (months)', num(report.duration_months, 1));
  kv('Velocity (MD/month)', num(report.velocity_md_month, 1));
  kv('Team size', num(report.team_size));
  kv('Risk count', num(report.risk_count));
  kv('Confidence', report.confidence);
  kv('Cross-dimension conflict', report.cross_dimension_conflict ?? '—');
  summary.getColumn(1).font = { bold: true };

  // ── Pillars ──────────────────────────────────────────────────────────────
  const pillars = wb.addWorksheet('Pillars');
  pillars.columns = [{ width: 24 }, { width: 10 }, { width: 60 }];
  header(pillars, ['Dimension', 'RAG', 'Reason']);
  for (const p of report.pillars) pillars.addRow([p.dimension, p.rag, p.reason ?? '']);

  // ── Gaps ─────────────────────────────────────────────────────────────────
  const gaps = wb.addWorksheet('Gaps');
  gaps.columns = [{ width: 10 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 50 }];
  header(gaps, ['Section', 'Component', 'Status', 'Severity', 'Note']);
  for (const g of report.gap_report)
    gaps.addRow([g.section_code ?? '', g.component_name ?? '', g.status, g.severity, g.note ?? '']);

  // ── Risk Warnings ──────────────────────────────────────────────────────────
  const risks = wb.addWorksheet('Risk Warnings');
  risks.columns = [{ width: 22 }, { width: 26 }, { width: 8 }, { width: 64 }];
  header(risks, ['Dimension', 'Metric', 'RAG', 'Why']);
  for (const w of report.risk_warnings) risks.addRow([w.dimension, w.metric, w.rag, w.why]);

  // ── Latent Risks (advisory; fire even when pillars are Green) ───────────────
  const latent = wb.addWorksheet('Latent Risks');
  latent.columns = [{ width: 20 }, { width: 10 }, { width: 36 }, { width: 64 }];
  header(latent, ['Code', 'Severity', 'Title', 'Detail']);
  for (const l of report.latent_risks) latent.addRow([l.code, l.severity, l.title, l.detail]);

  // ── Recommendations ────────────────────────────────────────────────────────
  const recs = wb.addWorksheet('Recommendations');
  recs.columns = [{ width: 8 }, { width: 50 }, { width: 50 }, { width: 16 }];
  header(recs, ['ID', 'Action', 'Rationale', 'Addresses']);
  for (const r of report.recommended_adjustments)
    recs.addRow([r.id, r.action, r.rationale, r.addresses.join(', ')]);

  // ── Capacity (raw DS01×DS08 per-role projected peak) ────────────────────────
  const cap = wb.addWorksheet('Capacity');
  cap.columns = [{ width: 24 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 10 }];
  header(cap, ['Role', 'Projected busy %', 'Peak month', 'Over capacity?', 'RAG']);
  for (const r of report.capacity.roles)
    cap.addRow([
      r.role,
      num(r.projected_busy_rate_pct),
      r.peak_month ?? '—',
      r.exceeds_spare ? 'yes' : 'no',
      r.rag ?? '—',
    ]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
