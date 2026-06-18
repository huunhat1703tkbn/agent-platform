import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pmoApi } from '../api/client';

export const pmoQueryKeys = {
  plans: () => ['pmo', 'plans'] as const,
  review: (planId: string) => ['pmo', 'review', planId] as const,
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

export function useIssuePmoReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => pmoApi.issueReview(planId),
    onSuccess: (_res, planId) => {
      qc.invalidateQueries({ queryKey: pmoQueryKeys.review(planId) });
    },
  });
}
