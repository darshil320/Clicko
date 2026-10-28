import type { BookingStatus } from '@clickco/contracts';

/** Board flags (AdminBookingRow.flags), from what each owning module reports. */
export type BookingFlag = 'NEEDS_REVIEW' | 'OPS_ALERT' | 'SLA_BREACHED' | 'INCIDENT_REPORTED';

const ON_SITE: readonly BookingStatus[] = ['CHECKED_IN', 'IN_PROGRESS'];

export function flagsFor(input: {
  readonly status: BookingStatus;
  readonly alertTypes: readonly string[];
  readonly slaBreached: boolean;
  readonly reportKinds: ReadonlySet<string>;
}): BookingFlag[] {
  const reportOpen =
    (ON_SITE.includes(input.status) &&
      (input.reportKinds.has('ACCESS_DENIED_REPORTED') ||
        input.reportKinds.has('UNSAFE_REPORTED'))) ||
    (input.status === 'CHECKED_OUT' && input.reportKinds.has('CLIENT_ABSENT_REPORTED'));
  return [
    ...(input.alertTypes.some((t) => t.endsWith('.needs_review')) ? ['NEEDS_REVIEW' as const] : []),
    ...(input.alertTypes.includes('ops.alert') ? ['OPS_ALERT' as const] : []),
    ...(input.slaBreached ? ['SLA_BREACHED' as const] : []),
    ...(reportOpen ? ['INCIDENT_REPORTED' as const] : []),
  ];
}
