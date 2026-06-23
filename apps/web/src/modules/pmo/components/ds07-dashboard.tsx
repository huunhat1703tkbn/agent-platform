import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@seta/shared-ui';
import { AlertTriangle, CheckCircle2, Download, FlaskConical, Lightbulb } from 'lucide-react';
import type { IssuedReport, ReviewReport } from '../api/client';
import { feasibilityKind, ragBadgeVariant, ragSurface, severityVariant } from './rag';

interface Props {
  report: ReviewReport;
  issued: IssuedReport | null;
  onIssue: () => void;
  isIssuing: boolean;
}

function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n * 10) / 10}%`;
}

function Metric({
  label,
  value,
  rag,
}: {
  label: string;
  value: string;
  rag?: 'Green' | 'Yellow' | 'Red' | null;
}) {
  return (
    <div className={`rounded-lg px-4 py-3 ${rag ? ragSurface(rag) : 'bg-surface-1 text-ink'}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function Ds07Dashboard({ report, issued, onIssue, isIssuing }: Props) {
  const r = report;
  const compliancePillar = r.pillars.find((p) => p.dimension === 'Compliance');
  const resourcePillar = r.pillars.find((p) => p.dimension === 'Resource');
  const thiPillar = r.pillars.find((p) => p.dimension === 'THI');

  function downloadWorkbook() {
    // Same-origin GET → the session cookie rides along; Content-Disposition: attachment
    // makes the browser download the .xlsx without navigating away from the SPA.
    const a = document.createElement('a');
    a.href = `/api/agent/v1/pmo/plans/${encodeURIComponent(r.plan_id)}/review/download`;
    a.download = `DS07_Review_${r.plan_id}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Verdict banner */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <StatusPill kind={feasibilityKind(r.feasibility_status)} />
              <h2 className="text-xl font-semibold text-ink">{r.feasibility_status}</h2>
              <Badge variant={ragBadgeVariant(r.risk_score.band)}>
                Risk {r.risk_score.score}/100
              </Badge>
              <Badge variant={r.confidence === 'high' ? 'secondary' : 'warning'}>
                {r.confidence} confidence
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-ink-muted">{r.feasibility_reason}</p>
            {r.risk_score.drivers.length > 0 && (
              <p className="max-w-2xl text-xs text-ink-muted">
                Risk drivers: {r.risk_score.drivers.join(' · ')}
              </p>
            )}
            {r.cross_dimension_conflict && r.cross_dimension_conflict !== r.feasibility_reason && (
              <div className="mt-1 flex items-start gap-2 rounded-md bg-semantic-warning-tint px-3 py-2 text-sm text-semantic-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{r.cross_dimension_conflict}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-2">
            {issued ? (
              <div className="rounded-md bg-semantic-success-tint px-3 py-2 text-center text-sm text-semantic-success">
                <CheckCircle2 className="mr-1 inline size-4" />
                Issued ({issued.status})
              </div>
            ) : (
              <Button onClick={onIssue} disabled={isIssuing}>
                {isIssuing ? 'Issuing…' : 'Issue DS07 Report'}
              </Button>
            )}
            <Button variant="secondary" onClick={downloadWorkbook}>
              <Download className="mr-1 size-4" />
              {issued ? 'Download report (.xlsx)' : 'Download draft (.xlsx)'}
            </Button>
            <span className="max-w-[16rem] text-center text-xs text-ink-muted">
              {issued
                ? 'Official record issued — download a copy anytime.'
                : 'Download = a copy to read · Issue = sign off the official record (saved + audited).'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Header metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Compliance"
          value={fmtPct(r.compliance_score_pct)}
          rag={compliancePillar?.rag}
        />
        <Metric
          label="Peak Busy"
          value={fmtPct(r.peak_role_busy_rate_pct)}
          rag={resourcePillar?.rag}
        />
        <Metric label="THI" value={fmtPct(r.thi_pct)} rag={thiPillar?.rag} />
        <Metric
          label="Velocity"
          value={r.velocity_md_month == null ? '—' : `${r.velocity_md_month} MD/mo`}
        />
        <Metric
          label="On-time hist."
          value={fmtPct(r.on_time_history_pct)}
          rag={r.benchmark.on_time_rag}
        />
        <Metric
          label="Risks"
          value={String(r.risk_count ?? 0)}
          rag={(r.risk_count ?? 0) === 0 ? 'Red' : 'Green'}
        />
      </div>

      {/* Pillars */}
      <div className="flex flex-wrap gap-2">
        {r.pillars.map((p) => (
          <Badge key={p.dimension} variant={ragBadgeVariant(p.rag)}>
            {p.dimension}: {p.rag}
          </Badge>
        ))}
      </div>

      {/* Detail tabs */}
      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps">Gaps ({r.gap_report.length})</TabsTrigger>
          <TabsTrigger value="risks">Risks ({r.risk_warnings.length})</TabsTrigger>
          <TabsTrigger value="advisory">Advisory ({r.latent_risks.length})</TabsTrigger>
          <TabsTrigger value="capacity">Capacity ({r.capacity.roles.length})</TabsTrigger>
          <TabsTrigger value="recs">
            Recommendations ({r.recommended_adjustments.length})
          </TabsTrigger>
          <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
        </TabsList>

        <TabsContent value="gaps">
          <Card>
            <CardContent className="p-0">
              {r.gap_report.length === 0 ? (
                <p className="p-6 text-sm text-ink-muted">
                  No section gaps — all required components are complete.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Section</TableHead>
                      <TableHead>Component</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.gap_report.map((g) => (
                      <TableRow key={g.check_id}>
                        <TableCell className="font-medium">{g.section_code}</TableCell>
                        <TableCell>{g.component_name ?? g.component_id}</TableCell>
                        <TableCell>
                          <Badge variant={g.status === 'Missing' ? 'destructive' : 'warning'}>
                            {g.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={severityVariant(g.severity)}>{g.severity}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {r.custom_sections.length > 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Custom sections flagged for review: {r.custom_sections.map((c) => c.name).join(', ')}
            </p>
          )}
        </TabsContent>

        <TabsContent value="risks">
          <div className="flex flex-col gap-3">
            {r.risk_warnings.length === 0 ? (
              <p className="text-sm text-ink-muted">No feasibility risks flagged.</p>
            ) : (
              r.risk_warnings.map((w) => (
                <Card key={`${w.dimension}-${w.metric}`}>
                  <CardContent className="flex items-start gap-3 p-4">
                    <AlertTriangle
                      className={`mt-0.5 size-5 shrink-0 ${ragSurface(w.rag)} rounded p-0.5`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{w.dimension}</span>
                        <Badge variant={ragBadgeVariant(w.rag)}>{w.metric}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-ink-muted">{w.why}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        Evidence: {w.evidence.source} · {w.evidence.row_id}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="advisory">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Advisory risks fire even when every pillar is Green — things a RAG verdict misses.
            </p>
            {r.latent_risks.length === 0 ? (
              <p className="text-sm text-ink-muted">No latent risks detected.</p>
            ) : (
              r.latent_risks.map((l) => (
                <Card key={`${l.code}-${l.title}`}>
                  <CardContent className="flex items-start gap-3 p-4">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-semantic-warning" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{l.title}</span>
                        <Badge
                          variant={
                            l.severity === 'high'
                              ? 'destructive'
                              : l.severity === 'medium'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {l.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-ink-muted">{l.detail}</p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="capacity">
          <Card>
            <CardContent className="p-0">
              {r.capacity.bottleneck && (
                <div className="border-b border-border-subtle p-4 text-sm">
                  <span className="font-medium text-ink">Bottleneck:</span>{' '}
                  <span className="text-ink">{r.capacity.bottleneck.role}</span> — projected{' '}
                  <span className="font-semibold tabular-nums">
                    {fmtPct(r.capacity.bottleneck.projected_busy_rate_pct)}
                  </span>
                  {r.capacity.bottleneck.peak_month
                    ? ` in ${r.capacity.bottleneck.peak_month}`
                    : ''}{' '}
                  (computed from DS01 × DS08)
                </div>
              )}
              {r.capacity.roles.length === 0 ? (
                <p className="p-6 text-sm text-ink-muted">No role capacity mapped for this plan.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Projected busy</TableHead>
                      <TableHead>Peak month</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.capacity.roles.map((role) => (
                      <TableRow key={role.role}>
                        <TableCell className="font-medium">{role.role}</TableCell>
                        <TableCell className="tabular-nums">
                          {fmtPct(role.projected_busy_rate_pct)}
                        </TableCell>
                        <TableCell>{role.peak_month ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={ragBadgeVariant(role.rag)}>{role.rag ?? '—'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recs">
          <div className="flex flex-col gap-3">
            {r.recommended_adjustments.map((rec) => (
              <Card key={rec.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <div className="font-medium text-ink">
                      {rec.id}. {rec.action}
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{rec.rationale}</p>
                    <div className="mt-1 flex gap-1">
                      {rec.addresses.map((a) => (
                        <Badge key={a} variant="outline">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="benchmark">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="size-4" /> {r.benchmark.cohort_project_type || 'Cohort'}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm text-ink">
              <div>
                Plan velocity{' '}
                <span className="font-semibold">
                  {r.benchmark.velocity.plan_velocity_md_month} MD/mo
                </span>{' '}
                vs cohort avg{' '}
                <span className="font-semibold">
                  {r.benchmark.cohort_avg_velocity_md_month == null
                    ? '—'
                    : `${Math.round(r.benchmark.cohort_avg_velocity_md_month * 10) / 10} MD/mo`}
                </span>
                {r.benchmark.velocity.rag && (
                  <Badge className="ml-2" variant={ragBadgeVariant(r.benchmark.velocity.rag)}>
                    {r.benchmark.velocity.rag}
                  </Badge>
                )}
              </div>
              <div className="text-ink-muted">
                Similar: {r.benchmark.similar_projects.join(', ') || '—'}
              </div>
              {r.benchmark.outliers_excluded.length > 0 && (
                <div className="text-ink-muted">
                  Outliers excluded: {r.benchmark.outliers_excluded.join(', ')}
                </div>
              )}
              {r.benchmark.insufficient_data && (
                <div className="text-semantic-warning">
                  Insufficient benchmark data — confidence lowered.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
