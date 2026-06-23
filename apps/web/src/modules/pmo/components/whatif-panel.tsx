import { Badge, Button, Card, CardContent } from '@seta/shared-ui';
import { ArrowRight, Lightbulb, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { usePmoHiring, usePmoWhatIf } from '../hooks/use-pmo';
import { ragBadgeVariant } from './rag';

interface Props {
  planId: string;
  roles: string[];
  defaultRole: string | null;
}

export function WhatIfPanel({ planId, roles, defaultRole }: Props) {
  const [role, setRole] = useState<string | null>(defaultRole ?? roles[0] ?? null);
  const [delta, setDelta] = useState(1);
  const hiring = usePmoHiring(planId);
  const sim = usePmoWhatIf(planId, role, delta);

  return (
    <div className="flex flex-col gap-4">
      {/* Inverse what-if: recommended hiring for the bottleneck */}
      {hiring.data && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-medium text-ink">Recommended hiring</div>
              <p className="mt-1 text-ink-muted">{hiring.data.note}</p>
              {hiring.data.remaining_blockers.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-xs text-ink-muted">Still blocks:</span>
                  {hiring.data.remaining_blockers.map((b) => (
                    <Badge key={b} variant="destructive">
                      {b}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Forward what-if: pick a role + headcount change */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              Role
            </div>
            <div className="flex flex-wrap gap-2">
              {roles.map((rname) => (
                <Button
                  key={rname}
                  size="sm"
                  variant={role === rname ? 'default' : 'secondary'}
                  onClick={() => setRole(rname)}
                >
                  {rname}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Headcount change
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDelta((d) => d - 1)}>
                <Minus className="size-4" />
              </Button>
              <span className="w-10 text-center text-lg font-semibold tabular-nums">
                {delta > 0 ? `+${delta}` : delta}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setDelta((d) => d + 1)}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {/* Before → after */}
          {sim.data?.role_found ? (
            <div className="flex flex-col gap-3 rounded-lg bg-surface-1 p-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-ink-muted">Resource</span>
                <Badge variant={ragBadgeVariant(sim.data.resource_rag_before)}>
                  {sim.data.resource_rag_before ?? '—'}
                </Badge>
                <ArrowRight className="size-4 text-ink-muted" />
                <Badge variant={ragBadgeVariant(sim.data.resource_rag_after)}>
                  {sim.data.resource_rag_after ?? '—'}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-ink-muted">Verdict</span>
                <span className="font-medium text-ink">{sim.data.feasibility_before}</span>
                <ArrowRight className="size-4 text-ink-muted" />
                <span
                  className={`font-semibold ${sim.data.changed ? 'text-semantic-success' : 'text-ink'}`}
                >
                  {sim.data.feasibility_after}
                </span>
              </div>
              <p className="text-sm text-ink-muted">{sim.data.note}</p>
            </div>
          ) : sim.data && !sim.data.role_found ? (
            <p className="text-sm text-semantic-warning">
              No "{role}" staffed on this plan. Available: {sim.data.available_roles.join(', ')}.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Pick a role to simulate.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
