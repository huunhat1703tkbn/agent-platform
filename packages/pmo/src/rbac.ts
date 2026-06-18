import { type Statement, toManifest } from '@seta/shared-rbac';

// Mirrored 1:1 into the single source of truth, packages/shared-rbac/src/inventory.ts
// (the INVENTORY array). Keep both identical — same resources, actions, role
// permissions, and role descriptions — and run `pnpm gen:rbac` after editing.
// Parity is enforced by tests/unit/rbac-parity.test.ts.
//
//   pmo.plan   — read the project-plan datasets (DS01–DS08) under review (the read tools).
//   pmo.review — read / write the DS07 review report (write is HITL-gated; P2 saveReviewReport).
export const pmoStatement = {
  'pmo.plan': ['read'],
  'pmo.review': ['read', 'write'],
} as const satisfies Statement;

const roleStatements = {
  'pmo.reviewer': { 'pmo.plan': ['read'], 'pmo.review': ['read', 'write'] },
  'pmo.viewer': { 'pmo.plan': ['read'], 'pmo.review': ['read'] },
} as const satisfies Record<string, Statement>;

export const pmoRbac = toManifest('pmo', pmoStatement, roleStatements, {
  'pmo.reviewer': 'Review project plans and issue DS07 review reports',
  'pmo.viewer': 'Read project plans and review reports',
});

export type PmoPermission = (typeof pmoRbac.permissions)[number]['key'];

export const PMO_PERMISSIONS = pmoRbac.permissions.map((p) => p.key);
