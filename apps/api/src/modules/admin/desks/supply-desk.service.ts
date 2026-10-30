import {
  type AdminApplicationBoard,
  type AdminApplicationCard,
  type AdminApplicationDetail,
  type AdminApplicationQuery,
  type AdminCreateApplicantBody,
  type AdminDocumentLink,
  type AdminKycDecisionBody,
  type AdminKycDecisionResponse,
  type AdminKycPage,
  type AdminMoveApplicationBody,
  type AdminPenalty,
  type AdminPhotographerPage,
  type AdminPhotographerProfile,
  type AdminPhotographerQuery,
  type AdminPhotographerStatusBody,
  type AdminWaivePenaltyBody,
  SUPPLY_ACTION_ROLES,
  Uuid,
} from '@clickco/contracts';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import { BookingsService } from '../../bookings/bookings.service';
import { PhotographerDirectoryService } from '../../photographers/directory.service';
import { KycService } from '../../photographers/kyc.service';
import { OnboardingService } from '../../photographers/onboarding.service';
import type { CityScope as SupplyScope } from '../../photographers/supply.types';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import {
  type CityScope,
  canSeeClientPhone,
  DESK_ROLES,
  scopeCovers,
  scopeFor,
} from '../access/roles';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, type ListQuery, pageOf, TimeCursor } from './paging';
import { StaffNames } from './staff-names';
import {
  toCard,
  toDirectoryRow,
  toDocumentSummary,
  toKycItem,
  toPenalty,
  toProfile,
  toVerification,
} from './supply-views';

export type DirectoryQuery = z.output<typeof AdminPhotographerQuery>;

const FULL_VIEW_ROLES = DESK_ROLES.photographers.filter((r) => r !== 'READ_ONLY');

/**
 * Phone search only when every city the caller searches shows them full phones (no READ_ONLY-only
 * city): a substring search would otherwise reveal masked digits one guess at a time.
 */
function seesPhones(caller: StaffCaller): boolean {
  const full = scopeFor(caller.grants, FULL_VIEW_ROLES);
  if (full === null) return false;
  if (full === 'ALL') return true;
  return caller.scope !== 'ALL' && caller.scope.every((cityId) => scopeCovers(full, cityId));
}

/** (name, uuid) keyset — the directory is alphabetical. */
const NameCursor = z.object({ n: z.string().max(200), i: Uuid });

/**
 * The photographers desk (ADR-0026 D5): onboarding kanban, KYC queue, directory, penalty waivers
 * and status changes. Roles are checked per route (@Roles) and, for the decisions only a city
 * manager takes, per city here. Every change commits with its audit row.
 */
@Injectable()
export class SupplyDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(KycService) private readonly kyc: KycService,
    @Inject(PhotographerDirectoryService) private readonly directory: PhotographerDirectoryService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StaffNames) private readonly names: StaffNames,
  ) {}

  // ── Onboarding ────────────────────────────────────────────────────────────

  async board(caller: StaffCaller, q: AdminApplicationQuery): Promise<AdminApplicationBoard> {
    const columns = await this.onboarding.board({
      scope: caller.scope,
      ...(q.cityId ? { cityId: q.cityId } : {}),
      ...(q.q ? { search: q.q } : {}),
      searchPhones: seesPhones(caller),
      now: this.clock(),
    });
    const cities = await this.cityNames(columns.flatMap((c) => c.items.map((i) => i.cityId)));
    return {
      columns: columns.map((col) => ({
        stage: col.stage,
        count: col.count,
        items: col.items.map((c) =>
          toCard(c, cities.get(c.cityId) ?? '', canSeeClientPhone(caller.grants, c.cityId)),
        ),
      })),
    };
  }

  async application(caller: StaffCaller, id: string): Promise<AdminApplicationDetail> {
    const d = await this.onboarding.detail(id, caller.scope);
    const [cities, names] = await Promise.all([
      this.cityNames([d.cityId]),
      this.names.of(d.history.map((h) => h.actorStaffId)),
    ]);
    return {
      ...toCard(d, cities.get(d.cityId) ?? '', canSeeClientPhone(caller.grants, d.cityId)),
      photographerStatus: d.photographerStatus,
      declaredGear: d.declaredGear,
      interviewAt: d.interviewAt?.toISOString() ?? null,
      interviewNotes: d.interviewNotes,
      decisionReason: d.decisionReason,
      decidedAt: d.decidedAt?.toISOString() ?? null,
      verification: toVerification(d.verification),
      documents: d.documentList.map(toDocumentSummary),
      history: d.history.map((h) => ({
        fromStage: h.fromStage,
        toStage: h.toStage,
        actorName: h.actorStaffId ? (names.get(h.actorStaffId) ?? null) : null,
        note: h.note,
        at: h.at.toISOString(),
      })),
    };
  }

  async move(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminMoveApplicationBody,
  ): Promise<AdminApplicationCard> {
    const decide = scopeFor(caller.grants, SUPPLY_ACTION_ROLES.decideApplication);
    const card = await this.onboarding.move({
      id,
      to: body.toStage,
      note: body.note,
      staffId: caller.id,
      scope: caller.scope,
      canDecide: (cityId) => decide !== null && scopeCovers(decide, cityId),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'photographer_application', id),
    });
    return this.card(caller, card);
  }

  async createApplicant(
    caller: StaffCaller,
    ctx: AuditContext,
    body: AdminCreateApplicantBody,
  ): Promise<AdminApplicationCard> {
    if (!scopeCovers(caller.scope, body.cityId)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only add applicants in your own cities',
      });
    }
    const card = await this.onboarding.createApplicant({
      applicant: {
        fullName: body.fullName,
        phone: body.phone,
        cityId: body.cityId,
        source: body.source,
        portfolioUrl: body.portfolioUrl ?? null,
        yearsExperience: body.yearsExperience ?? null,
        requestedMaxTier: body.requestedMaxTier ?? null,
        note: body.note ?? null,
      },
      staffId: caller.id,
      now: this.clock(),
      auditFor: (applicationId) => this.audit.hook(ctx, 'photographer_application', applicationId),
    });
    return this.card(caller, card);
  }

  // ── KYC ───────────────────────────────────────────────────────────────────

  async kycQueue(caller: StaffCaller, q: ListQuery): Promise<AdminKycPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.kyc.queue({
      scope: caller.scope,
      ...(cursor ? { after: { uploadedAt: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (d) => ({ t: d.uploadedAt.toISOString(), i: d.id }));
    const cities = await this.cityNames(page.items.map((d) => d.cityId));
    return {
      items: page.items.map((d) => toKycItem(d, cities.get(d.cityId) ?? '')),
      nextCursor: page.nextCursor,
    };
  }

  /** The 5-minute signed link; audited `kyc.document_view` before it is returned. */
  async documentLink(
    caller: StaffCaller,
    ctx: AuditContext,
    documentId: string,
  ): Promise<AdminDocumentLink> {
    const link = await this.kyc.viewLink({
      id: documentId,
      scope: caller.scope,
      now: this.clock(),
      audit: this.audit.hook(ctx, 'photographer_document', documentId),
    });
    return {
      url: link.url,
      expiresAt: link.expiresAt.toISOString(),
      opensInBrowser: link.url.startsWith('https://'),
    };
  }

  async decideKyc(
    caller: StaffCaller,
    ctx: AuditContext,
    documentId: string,
    body: AdminKycDecisionBody,
  ): Promise<AdminKycDecisionResponse> {
    const { document, verification } = await this.kyc.decide({
      id: documentId,
      decision: body.decision,
      note: body.note ?? null,
      staffId: caller.id,
      scope: caller.scope,
      now: this.clock(),
      audit: this.audit.hook(ctx, 'photographer_document', documentId),
    });
    return {
      ...toDocumentSummary(document),
      photographerId: document.photographerId,
      verification: toVerification(verification),
    };
  }

  // ── Directory ─────────────────────────────────────────────────────────────

  async directoryPage(caller: StaffCaller, q: DirectoryQuery): Promise<AdminPhotographerPage> {
    const cursor = decodeCursor(NameCursor, q.cursor);
    const rows = await this.directory.page({
      scope: caller.scope,
      ...(q.cityId ? { cityId: q.cityId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { search: q.q } : {}),
      searchPhones: seesPhones(caller),
      ...(cursor ? { after: { fullName: cursor.n, id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => ({ n: r.fullName, i: r.id }));
    const cities = await this.cityNames(page.items.map((r) => r.cityId));
    return {
      items: page.items.map((r) =>
        toDirectoryRow(r, cities.get(r.cityId) ?? '', canSeeClientPhone(caller.grants, r.cityId)),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async profile(caller: StaffCaller, id: string): Promise<AdminPhotographerProfile> {
    const p = await this.directory.profile(id, caller.scope);
    const bookingIds = p.penalties.flatMap((x) => (x.bookingId ? [x.bookingId] : []));
    const [cities, facts] = await Promise.all([
      this.cityNames([p.cityId]),
      this.bookings.adminFacts(bookingIds),
    ]);
    return toProfile(p, {
      cityName: cities.get(p.cityId) ?? '',
      canSeePhone: canSeeClientPhone(caller.grants, p.cityId),
      references: new Map(facts.map((f) => [f.id, f.reference])),
    });
  }

  async waivePenalty(
    caller: StaffCaller,
    ctx: AuditContext,
    penaltyId: string,
    body: AdminWaivePenaltyBody,
  ): Promise<AdminPenalty> {
    const penalty = await this.directory.waivePenalty({
      id: penaltyId,
      reason: body.reason,
      scope: caller.scope,
      audit: this.audit.hook(ctx, 'photographer_penalty', penaltyId),
    });
    const facts = penalty.bookingId ? await this.bookings.adminFacts([penalty.bookingId]) : [];
    return toPenalty(penalty, facts[0]?.reference ?? null);
  }

  async changeStatus(
    caller: StaffCaller,
    ctx: AuditContext,
    photographerId: string,
    body: AdminPhotographerStatusBody,
  ): Promise<AdminPhotographerProfile> {
    await this.directory.changeStatus({
      id: photographerId,
      action: body.action,
      reason: body.reason,
      scope: caller.scope,
      now: this.clock(),
      audit: this.audit.hook(ctx, 'photographer', photographerId),
    });
    return this.profile(caller, photographerId);
  }

  // ── Today (ADR-0026 D8): cheap counts for the overview ───────────────────

  /** Applications moving through onboarding (not on hold) in `scope`. */
  overviewApplicationsWaiting(scope: CityScope): Promise<number> {
    return this.onboarding.countWaiting(scope as SupplyScope);
  }

  /** KYC documents waiting for a decision in `scope`. */
  overviewKycPending(scope: CityScope): Promise<number> {
    return this.kyc.countPending(scope as SupplyScope);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async card(
    caller: StaffCaller,
    c: Parameters<typeof toCard>[0],
  ): Promise<AdminApplicationCard> {
    const cities = await this.cityNames([c.cityId]);
    return toCard(c, cities.get(c.cityId) ?? '', canSeeClientPhone(caller.grants, c.cityId));
  }

  private cityNames(ids: readonly string[]): Promise<Map<string, string>> {
    return this.serviceability.cityNames([...new Set(ids)]);
  }
}
