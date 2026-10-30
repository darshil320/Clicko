import type {
  AdminClaimItem,
  AdminQualityItem,
  AdminTicketDetail,
  AdminTicketItem,
  ClaimEvidence,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type {
  ClaimRecord,
  QualityRecord,
  TicketMessageRecord,
  TicketRecord,
} from '../../care/care.types';
import type { BookingContext } from './care-context';

/** Care records → the panel's contracts (ADR-0026 D6). Money leaves as integer paise. */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const name = (names: ReadonlyMap<string, string>, id: string | null): string | null =>
  id ? (names.get(id) ?? null) : null;

export function toQualityItem(
  q: QualityRecord,
  ctx: BookingContext,
  staff: ReadonlyMap<string, string>,
): AdminQualityItem | null {
  const b = ctx.facts.get(q.bookingId);
  if (!b) return null;
  return {
    id: q.id,
    bookingId: q.bookingId,
    reference: b.reference,
    cityName: ctx.cities.get(b.cityId) ?? '',
    clientName: b.clientName,
    photographerName: ctx.photographerOf.get(q.bookingId)?.name ?? null,
    categoryCode: b.categoryCode,
    tier: b.tier,
    complaint: q.complaint,
    status: q.status,
    raisedByKind: q.raisedByKind,
    raisedByName: q.raisedByKind === 'STAFF' ? name(staff, q.raisedById) : null,
    assignedQmId: q.assignedQmId,
    assignedQmName: name(staff, q.assignedQmId),
    outcome: q.resolution,
    remedyPaise: fromPaiseBigint(q.remedyPaise),
    resolutionNote: q.resolutionNote,
    bookingTotalPaise: fromPaiseBigint(b.totalPaise),
    amountPaidPaise: fromPaiseBigint(b.amountPaidPaise),
    createdAt: q.createdAt.toISOString(),
    resolvedAt: iso(q.resolvedAt),
  };
}

export function toTicketItem(
  t: TicketRecord,
  references: ReadonlyMap<string, string>,
  staff: ReadonlyMap<string, string>,
): AdminTicketItem {
  return {
    id: t.id,
    reference: t.reference,
    subject: t.subject,
    category: t.category,
    isGrievance: t.isGrievance,
    status: t.status,
    raisedByKind: t.raisedByKind,
    contactName: t.contactName,
    contactPhone: t.contactPhone,
    contactEmail: t.contactEmail,
    bookingId: t.bookingId,
    bookingReference: t.bookingId ? (references.get(t.bookingId) ?? null) : null,
    assignedToId: t.assignedTo,
    assignedToName: name(staff, t.assignedTo),
    receivedAt: t.receivedAt.toISOString(),
    ackDueAt: t.ackDueAt.toISOString(),
    acknowledgedAt: iso(t.acknowledgedAt),
    resolveDueAt: t.resolveDueAt.toISOString(),
    resolvedAt: iso(t.resolvedAt),
    lastMessageAt: iso(t.lastMessageAt),
    messageCount: t.messageCount,
  };
}

export function toTicketDetail(
  t: TicketRecord,
  messages: readonly TicketMessageRecord[],
  references: ReadonlyMap<string, string>,
  staff: ReadonlyMap<string, string>,
): AdminTicketDetail {
  return {
    ...toTicketItem(t, references, staff),
    resolutionSummary: t.resolutionSummary,
    messages: messages.map((m) => ({
      id: m.id,
      authorKind: m.authorKind,
      authorName:
        m.authorKind === 'STAFF'
          ? name(staff, m.authorId)
          : m.authorKind === 'CUSTOMER'
            ? t.contactName
            : null,
      body: m.body,
      isInternal: m.isInternal,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export function toClaimItem(
  c: ClaimRecord,
  ctx: BookingContext,
  photographers: ReadonlyMap<string, string>,
  staff: ReadonlyMap<string, string>,
): AdminClaimItem | null {
  const b = ctx.facts.get(c.bookingId);
  if (!b) return null;
  const evidence: ClaimEvidence[] = c.evidence.map((e) =>
    e.kind === 'LINK'
      ? {
          kind: 'LINK',
          url: e.url,
          label: e.label,
          addedAt: e.addedAt,
          addedByName: name(staff, e.addedBy),
        }
      : { kind: 'NOTE', text: e.text, addedAt: e.addedAt, addedByName: name(staff, e.addedBy) },
  );
  return {
    id: c.id,
    bookingId: c.bookingId,
    bookingReference: b.reference,
    cityName: ctx.cities.get(b.cityId) ?? '',
    clientName: b.clientName,
    photographerId: c.photographerId,
    photographerName: photographers.get(c.photographerId) ?? '',
    cause: c.cause,
    description: c.description,
    incidentAt: c.incidentAt.toISOString(),
    reportedAt: c.reportedAt.toISOString(),
    claimedAmountPaise: fromPaiseBigint(c.claimedAmountPaise),
    capPaise: fromPaiseBigint(c.capPaise),
    approvedAmountPaise:
      c.approvedAmountPaise === null ? null : fromPaiseBigint(c.approvedAmountPaise),
    status: c.status,
    evidence,
    reviewedByName: name(staff, c.reviewedBy),
    resolutionNote: c.resolutionNote,
    resolvedAt: iso(c.resolvedAt),
  };
}

/** Staff ids an evidence trail mentions. */
export const evidenceStaff = (c: ClaimRecord): Array<string | null> => [
  c.reviewedBy,
  ...c.evidence.map((e) => e.addedBy),
];
