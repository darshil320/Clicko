import type {
  AdminAlert,
  AdminAuditEntry,
  AdminBookingRow,
  AdminBreachItem,
  SlaBreachView,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { AdminBookingFacts } from '../../bookings/bookings.types';
import type { AlertRecord } from '../../ops/ops-alerts.reader';
import type { BreachRecord } from '../../sla/repositories/sla-breaches.repository';
import type { AuditRecord } from '../audit/audit.repository';

/** Wire mappers for the staff desks. Money leaves as integer paise numbers (ADR-0007). */

export function toBookingRow(
  b: AdminBookingFacts,
  extra: {
    readonly cityName: string;
    readonly photographerName: string | null;
    readonly nextDueAt: Date | null;
    readonly flags: readonly string[];
  },
): AdminBookingRow {
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    cityId: b.cityId,
    cityName: extra.cityName,
    categoryCode: b.categoryCode,
    tier: b.tier,
    emergencyBand: b.emergencyBand,
    scheduledStart: b.scheduledStart.toISOString(),
    scheduledHours: b.scheduledHours,
    clientName: b.clientName,
    photographerName: extra.photographerName,
    totalPaise: fromPaiseBigint(b.totalPaise),
    amountPaidPaise: fromPaiseBigint(b.amountPaidPaise),
    nextDueAt: extra.nextDueAt?.toISOString() ?? null,
    flags: [...extra.flags],
  };
}

export function toBreachView(b: BreachRecord): SlaBreachView & { id: string } {
  return {
    id: b.id,
    kind: b.kind,
    delayMinutes: b.delayMinutes,
    band: b.band,
    remedyKind: b.remedyKind,
    remedyPaise: fromPaiseBigint(b.remedyPaise),
    payoutDeductionBps: b.payoutDeductionBps,
    attributedTo: b.attributedTo,
    applied: b.appliedAt !== null,
  };
}

export function toBreachItem(
  b: BreachRecord,
  extra: {
    readonly reference: string;
    readonly cityName: string;
    readonly photographerName: string | null;
  },
): AdminBreachItem {
  return {
    ...toBreachView(b),
    bookingId: b.bookingId,
    reference: extra.reference,
    cityName: extra.cityName,
    photographerName: extra.photographerName,
    waived: b.waivedBy !== null,
    waiveReason: b.waiveReason,
    createdAt: b.createdAt.toISOString(),
  };
}

export function alertSummary(a: AlertRecord): string {
  if (a.type === 'ops.alert') return `${a.severity ?? 'ALERT'}: ${a.reason ?? 'ops alert'}`;
  return `Needs review: ${a.reason ?? a.type}`;
}

export function toAlert(a: AlertRecord, bookingReference: string | null): AdminAlert {
  return {
    eventId: a.eventId,
    type: a.type,
    reason: a.reason,
    bookingId: a.bookingId,
    bookingReference,
    summary: alertSummary(a),
    occurredAt: a.occurredAt.toISOString(),
  };
}

export function toAuditEntry(a: AuditRecord): AdminAuditEntry {
  return {
    id: a.id,
    action: a.action,
    actorKind: a.actorKind,
    actorEmail: a.actorEmail,
    entityKind: a.entityKind,
    entityId: a.entityId,
    before: a.before,
    after: a.after,
    occurredAt: a.occurredAt.toISOString(),
  };
}
