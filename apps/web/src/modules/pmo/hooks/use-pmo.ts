import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pmoApi } from '../api/client';

export const pmoQueryKeys = {
  plans: () => ['pmo', 'plans'] as const,
  review: (planId: string) => ['pmo', 'review', planId] as const,
  similar: (planId: string) => ['pmo', 'similar', planId] as const,
  hiring: (planId: string) => ['pmo', 'hiring', planId] as const,
  whatif: (planId: string, role: string, delta: number) =>
    ['pmo', 'whatif', planId, role, delta] as const,
};

export function usePmoPlans() {
  return useQuery({ queryKey: pmoQueryKeys.plans(), queryFn: pmoApi.listPlans });
}

export function usePmoReview(planId: string | null) {
  return useQuery({
    queryKey: pmoQueryKeys.review(planId ?? ''),
    queryFn: () => pmoApi.getReview(planId as string),
    enabled: planId != null,
  });
}

export function usePmoSimilar(planId: string | null) {
  return useQuery({
    queryKey: pmoQueryKeys.similar(planId ?? ''),
    queryFn: () => pmoApi.getSimilar(planId as string),
    enabled: planId != null,
  });
}

export function usePmoHiring(planId: string | null) {
  return useQuery({
    queryKey: pmoQueryKeys.hiring(planId ?? ''),
    queryFn: () => pmoApi.getHiring(planId as string),
    enabled: planId != null,
  });
}

export function usePmoWhatIf(planId: string | null, role: string | null, delta: number) {
  return useQuery({
    queryKey: pmoQueryKeys.whatif(planId ?? '', role ?? '', delta),
    queryFn: () => pmoApi.getWhatIf(planId as string, role as string, delta),
    enabled: planId != null && role != null && role !== '',
  });
}

export function useIssuePmoReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => pmoApi.issueReview(planId),
    onSuccess: (_res, planId) => {
      qc.invalidateQueries({ queryKey: pmoQueryKeys.review(planId) });
    },
  });
}
