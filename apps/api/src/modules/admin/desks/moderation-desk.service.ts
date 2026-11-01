import type {
  AdminModerationDecisionBody,
  AdminModerationDetail,
  AdminModerationItem,
  AdminModerationPage,
  AdminModerationQuery,
} from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import { BookingsService } from '../../bookings/bookings.service';
import { PhotographersService } from '../../photographers/photographers.service';
import type { ReviewRecord } from '../../reviews/reviews.types';
import { ModerationService } from '../../safety/moderation.service';
import type { Reporter, ReportRecord } from '../../safety/safety.types';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import { UsersService } from '../../users/users.service';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { OverviewRegistry } from '../overview/overview.registry';
import { isAre, plural } from '../overview/overview-source';
import { decodeCursor, pageOf, TimeCursor } from './paging';
import { StaffNames } from './staff-names';

export type ModerationQuery = z.output<typeof AdminModerationQuery>;

/** Names and references around a set of reports, each asked of the module that owns it. */
interface Names {
  readonly people: ReadonlyMap<string, string>;
  readonly cities: ReadonlyMap<string, string>;
  readonly references: ReadonlyMap<string, string>;
  readonly staff: ReadonlyMap<string, string>;
  readonly reviews: ReadonlyMap<string, ReviewRecord>;
}

const personKey = (p: Reporter): string => `${p.kind}:${p.id}`;

/** The list's sort time: when it was filed (OPEN), else when it was decided. */
const sortAt = (r: ReportRecord, view: ModerationQuery['status']): Date =>
  view === 'OPEN' ? r.createdAt : (r.decidedAt ?? r.createdAt);

/**
 * The moderation desk (ADR-0027 D4): reports of reviews, clients and photographers in the
 * caller's cities, keyset-paged; one report with its target; the decision (audited in the
 * decision's own transaction). Decisions and data live in the safety module; this desk only
 * scopes, names and shapes. Registers the desk's "Needs you" count on Today.
 */
@Injectable()
export class ModerationDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(StaffNames) private readonly staffNames: StaffNames,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OverviewRegistry) overview: OverviewRegistry,
  ) {
    overview.register({
      key: 'moderation.open',
      desk: 'moderation',
      count: ({ scope }) => this.moderation.countOpen(scope),
      needsYou: {
        tone: 'attention',
        title: 'Reports to review',
        line: (n) =>
          `${plural(n, 'report')} of reviews or people ${isAre(n)} waiting for a decision.`,
        action: 'Review reports',
      },
    });
  }

  async list(caller: StaffCaller, q: ModerationQuery): Promise<AdminModerationPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.moderation.page({
      view: q.status,
      scope: caller.scope,
      ...(cursor ? { after: { at: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => ({
      t: sortAt(r, q.status).toISOString(),
      i: r.id,
    }));
    const names = await this.names(page.items);
    return { items: page.items.map((r) => this.item(r, names)), nextCursor: page.nextCursor };
  }

  async detail(caller: StaffCaller, id: string): Promise<AdminModerationDetail> {
    const facts = await this.moderation.facts(id, caller.scope);
    const names = await this.names(
      [facts.report],
      [...(facts.person ? [facts.person] : [])],
      facts.history.map((h) => h.staffId),
    );
    const review = facts.review;
    return {
      ...this.item(facts.report, names),
      review: review
        ? {
            id: review.id,
            rating: review.rating,
            comment: review.comment,
            isPublished: review.isPublished,
            photographerId: review.photographerId,
            photographerName: review.photographerId
              ? (names.people.get(`PHOTOGRAPHER:${review.photographerId}`) ?? null)
              : null,
            authorName: facts.person ? (names.people.get(personKey(facts.person)) ?? null) : null,
            createdAt: review.createdAt.toISOString(),
            updatedAt: review.updatedAt.toISOString(),
          }
        : null,
      reportedReview:
        facts.report.reportedRating !== null
          ? { rating: facts.report.reportedRating, comment: facts.report.reportedComment }
          : null,
      person: facts.person
        ? {
            kind: facts.person.kind,
            id: facts.person.id,
            name: names.people.get(personKey(facts.person)) ?? null,
            warnings: facts.person.warnings,
            openReports: facts.person.openReports,
          }
        : null,
      otherOpenReports: facts.otherOpenReports,
      history: facts.history.map((h) => ({
        decision: h.decision,
        note: h.note,
        staffName: names.staff.get(h.staffId) ?? null,
        reportsClosed: h.reportsClosed,
        decidedAt: h.createdAt.toISOString(),
      })),
      allowedDecisions: [...facts.allowedDecisions],
    };
  }

  async decide(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminModerationDecisionBody,
  ): Promise<AdminModerationDetail> {
    await this.moderation.decide({
      reportId: id,
      decision: body.decision,
      note: body.note,
      staffId: caller.id,
      scope: caller.scope,
      now: this.clock(),
      audit: this.audit.hook(ctx, 'moderation_report', id),
    });
    return this.detail(caller, id);
  }

  private item(r: ReportRecord, n: Names): AdminModerationItem {
    const review = r.targetKind === 'REVIEW' ? n.reviews.get(r.targetId) : undefined;
    const targetName =
      r.targetKind === 'REVIEW'
        ? review?.photographerId
          ? (n.people.get(`PHOTOGRAPHER:${review.photographerId}`) ?? null)
          : null
        : (n.people.get(`${r.targetKind}:${r.targetId}`) ?? null);
    return {
      id: r.id,
      targetKind: r.targetKind,
      targetId: r.targetId,
      targetName,
      reason: r.reason,
      note: r.note,
      reporterKind: r.reporterKind,
      reporterName: n.people.get(`${r.reporterKind}:${r.reporterId}`) ?? null,
      cityName: n.cities.get(r.cityId) ?? '',
      bookingId: r.bookingId,
      bookingReference: r.bookingId ? (n.references.get(r.bookingId) ?? null) : null,
      status: r.status,
      decision: r.decision,
      decisionNote: r.decisionNote,
      decidedByName: r.decidedBy ? (n.staff.get(r.decidedBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  }

  private async names(
    reports: readonly ReportRecord[],
    extraPeople: readonly Reporter[] = [],
    extraStaff: readonly string[] = [],
  ): Promise<Names> {
    const reviews = await this.moderation.reviewsOf(
      reports.filter((r) => r.targetKind === 'REVIEW').map((r) => r.targetId),
    );
    const people: Reporter[] = [
      ...reports.map((r) => ({ kind: r.reporterKind, id: r.reporterId })),
      ...reports.flatMap((r) =>
        r.targetKind === 'REVIEW' ? [] : [{ kind: r.targetKind, id: r.targetId }],
      ),
      ...[...reviews.values()].flatMap((v) =>
        v.photographerId ? [{ kind: 'PHOTOGRAPHER' as const, id: v.photographerId }] : [],
      ),
      ...extraPeople,
    ];
    const bookingIds = [...new Set(reports.flatMap((r) => (r.bookingId ? [r.bookingId] : [])))];
    const [peopleNames, cities, facts, staff] = await Promise.all([
      this.peopleNames(people),
      this.serviceability.cityNames([...new Set(reports.map((r) => r.cityId))]),
      bookingIds.length > 0 ? this.bookings.adminFacts(bookingIds) : Promise.resolve([]),
      this.staffNames.of([...reports.map((r) => r.decidedBy), ...extraStaff]),
    ]);
    return {
      people: peopleNames,
      cities,
      references: new Map(facts.map((f) => [f.id, f.reference])),
      staff,
      reviews,
    };
  }

  /** "USER:<id>" / "PHOTOGRAPHER:<id>" → display name (clients one by one: a page is small). */
  private async peopleNames(people: readonly Reporter[]): Promise<Map<string, string>> {
    const ids = (kind: Reporter['kind']) => [
      ...new Set(people.filter((p) => p.kind === kind).map((p) => p.id)),
    ];
    const [pros, clients] = await Promise.all([
      this.photographers.displayNames(ids('PHOTOGRAPHER')),
      Promise.all(ids('USER').map((id) => this.users.findById(id))),
    ]);
    return new Map([
      ...[...pros.entries()].map(([id, name]) => [`PHOTOGRAPHER:${id}`, name] as const),
      ...clients.flatMap((u) => (u?.fullName ? [[`USER:${u.id}`, u.fullName] as const] : [])),
    ]);
  }
}
