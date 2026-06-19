import type { SpecializedAgentRunCtx } from '@seta/agent-sdk';

/**
 * Deny-by-default permission gate. The chat route threads the actor's resolved
 * permission set onto the run ctx; the orchestrator re-checks pmo.* here because
 * it calls pmo domain functions directly (not via pmo's own RBAC-gated agent
 * tools), so access must be enforced at this boundary.
 */
export function assertPermission(ctx: SpecializedAgentRunCtx, perm: string): void {
  if (!ctx.effectivePermissions?.has(perm)) {
    throw new Error(`pmo-review: missing permission ${perm}`);
  }
}
