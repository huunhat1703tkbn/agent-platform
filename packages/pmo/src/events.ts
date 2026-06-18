import { z } from 'zod';

export const PMO_REPORT_ISSUED = 'pmo.report.issued' as const;
export const PMO_REPORT_ISSUED_VERSION = 1 as const;

export interface PmoReportIssuedPayload {
  actor: { type: 'user'; user_id: string };
  tenant_id: string;
  report_id: string;
  plan_id: string;
  feasibility_status: string;
  compliance_score_pct: number;
}

export const PMO_REPORT_ISSUED_PAYLOAD = z.object({
  actor: z.object({ type: z.literal('user'), user_id: z.string() }),
  tenant_id: z.string(),
  report_id: z.string(),
  plan_id: z.string(),
  feasibility_status: z.string(),
  compliance_score_pct: z.number(),
});

export const PMO_EVENTS = {
  [PMO_REPORT_ISSUED]: PMO_REPORT_ISSUED_PAYLOAD,
} as const;
