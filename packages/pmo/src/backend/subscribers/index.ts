import type { SubscriberDef } from '@seta/shared-types';
import { PMO_REPORT_ISSUED, PMO_REPORT_ISSUED_VERSION } from '../../events.ts';
import { exportIssuedReportHandler } from './export-report.ts';

/** pmo's domain-event subscribers (worker runtime). */
export function pmoSubscribers(): SubscriberDef[] {
  return [
    {
      event: PMO_REPORT_ISSUED,
      eventVersion: PMO_REPORT_ISSUED_VERSION,
      subscription: 'pmo.export-ds07-to-s3',
      handler: exportIssuedReportHandler as SubscriberDef['handler'],
    },
  ];
}
