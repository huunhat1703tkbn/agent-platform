import type { StatusKind } from '@seta/shared-ui';
import type { FeasibilityStatus, Rag } from '../api/client';

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary';

export function ragBadgeVariant(rag: Rag | null | undefined): BadgeVariant {
  if (rag === 'Green') return 'success';
  if (rag === 'Yellow') return 'warning';
  if (rag === 'Red') return 'destructive';
  return 'secondary';
}

/** Tailwind token classes for a RAG-tinted surface (uses the shared design tokens). */
export function ragSurface(rag: Rag | null | undefined): string {
  if (rag === 'Green') return 'bg-semantic-success-tint text-semantic-success';
  if (rag === 'Yellow') return 'bg-semantic-warning-tint text-semantic-warning';
  if (rag === 'Red') return 'bg-destructive-tint text-destructive';
  return 'bg-surface-1 text-ink-muted';
}

export function feasibilityKind(status: FeasibilityStatus): StatusKind {
  if (status === 'Feasible (Green)') return 'on-track';
  if (status === 'Needs review (Yellow)') return 'at-risk';
  return 'off-track';
}

export function severityVariant(severity: 'High' | 'Medium' | 'Low'): BadgeVariant {
  if (severity === 'High') return 'destructive';
  if (severity === 'Medium') return 'warning';
  return 'secondary';
}
