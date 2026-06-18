import { Button, EmptyState, PageChrome, Skeleton } from '@seta/shared-ui';
import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Ds07Dashboard } from './components/ds07-dashboard';
import { useIssuePmoReview, usePmoPlans, usePmoReview } from './hooks/use-pmo';

export function PmoPage() {
  const { data: plans, isPending: plansPending } = usePmoPlans();
  const [planId, setPlanId] = useState<string | null>(null);
  const selected = planId ?? plans?.[0]?.plan_id ?? null;

  const { data: review, isPending: reviewPending } = usePmoReview(selected);
  const issue = useIssuePmoReview();

  return (
    <PageChrome
      breadcrumb={['Agent']}
      title="ProjectPlanGuard"
      subtitle="PMO-01 — Project Plan Review & Feasibility Validation"
    >
      <div className="min-h-full bg-surface-1 px-4 py-6 pb-10 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          {/* Plan picker */}
          {plansPending ? (
            <Skeleton className="h-10 w-full" />
          ) : (plans?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-10" />}
              title="No plans to review"
              description="Seed the PMO-01 dataset to populate plans for review."
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {plans?.map((p) => (
                <Button
                  key={p.plan_id}
                  variant={selected === p.plan_id ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setPlanId(p.plan_id)}
                >
                  {p.plan_id} · {p.project_name ?? p.project_id}
                </Button>
              ))}
            </div>
          )}

          {/* DS07 review */}
          {selected == null ? null : reviewPending || !review ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <Ds07Dashboard
              report={review.report}
              issued={review.issued}
              onIssue={() => issue.mutate(selected)}
              isIssuing={issue.isPending}
            />
          )}

          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <ShieldCheck className="size-3.5" />
            Verdicts are computed deterministically from the plan datasets; issuing a report
            requires PMO approval.
          </p>
        </div>
      </div>
    </PageChrome>
  );
}
