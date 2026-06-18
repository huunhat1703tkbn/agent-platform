import type { NavManifest, NavSection } from '@seta/module-sdk';
import { ShieldCheck } from 'lucide-react';

function useNavExtensions(): NavSection[] {
  return [];
}

export const pmoNavManifest: NavManifest = {
  id: 'pmo',
  label: 'ProjectPlanGuard',
  icon: ShieldCheck,
  requiredPermissions: ['pmo.plan.read'],
  nav: [
    {
      label: 'PMO',
      items: [{ id: 'pmo.review', icon: ShieldCheck, label: 'Plan Review', to: '/pmo/review' }],
    },
  ],
  useNavExtensions,
};
