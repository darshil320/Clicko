import { randomUUID } from 'node:crypto';
import {
  type AdminPricingPreview,
  type AdminPricingPreviewQuery,
  PRICING_EDITOR_LIMITS,
  type PricingDiffRow,
  type PricingDraftChange,
  type PricingPreviewResult,
  type PricingPreviewSide,
} from '@clickco/contracts';
import { fromPaiseBigint, roundHalfUp } from '@clickco/utils';
import {
  ConflictException,
  type HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { AuditState, TxHook } from '../../common/tx-hook';
import { appendDomainEvent, type EventValue } from '../../infra/outbox/outbox';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import {
  canCancelSchedule,
  type EffectiveFrom,
  resolveEffectiveFrom,
  rulesetState,
  versionFor,
} from './editor/lifecycle';
import type { RulesetContent, RulesetRecord } from './editor/ruleset-content';
import { diffRulesets } from './editor/ruleset-diff';
import { computeQuote } from './engine';
import type { Ruleset } from './engine/types';
import { gstStateCode } from './gst-state-codes';
import { toPriceQuote } from './quote-response';
import { PricingRepository } from './repositories/pricing.repository';
import { RulesetEditorRepository, type Tx } from './repositories/ruleset-editor.repository';

/** Waiting time is 60% of the extension hourly (doc 05 §5). */
export const WAITING_SHARE_BPS = 6_000n;
const BPS = 10_000n;
const KM_TO_METRES = 1000;

/** The audit hook for one ruleset (the admin desk records it in the change's transaction). */
export type AuditFor = (rulesetId: string) => TxHook;

type ParsedChange = Extract<PricingDraftChange, { kind: string }> & { syncExtension?: boolean };

const fail = (Exception: new (body: object) => HttpException, code: string, message: string) =>
  new Exception({ code, message });

const notFound = () =>
  fail(NotFoundException, 'RULESET_NOT_FOUND', 'That rate card does not exist');

/** Money for an audit row or event: integer paise as a number (ADR-0007). */
const asState = (value: unknown): AuditState => JSON.parse(JSON.stringify(value)) as AuditState;

export interface RulesetDetail {
  readonly record: RulesetRecord;
  readonly content: RulesetContent;
  /** Drafts: rows that differ from live. */
  readonly changeCount: number | null;
}

export interface RulesetOverview {
  readonly live: RulesetRecord | null;
  readonly scheduled: RulesetRecord | null;
  readonly drafts: readonly RulesetRecord[];
  readonly history: readonly RulesetRecord[];
  readonly changeCounts: ReadonlyMap<string, number>;
}

export interface RulesetDiff {
  readonly record: RulesetRecord;
  readonly against: RulesetRecord | null;
  readonly liveChangedSinceCopy: boolean;
  readonly rows: readonly PricingDiffRow[];
}

/**
 * The pricing editor (doc 05 §11, ADR-0026 D4): draft → preview → publish. A draft is a full
 * copy of a published ruleset (`published_at IS NULL`) and can never price a booking; only
 * drafts are edited; a publish sets the window and closes the previous ruleset in one
 * transaction with its audit row and outbox event. Rulesets are never deleted (Invariant 17:
 * bookings keep theirs). Role and step-up checks belong to the admin desk that calls this.
 */
@Injectable()
export class RulesetEditorService {
  constructor(
    @Inject(RulesetEditorRepository) private readonly repo: RulesetEditorRepository,
    @Inject(PricingRepository) private readonly engineRepo: PricingRepository,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async overview(): Promise<RulesetOverview> {
    const now = this.clock();
    const all = await this.repo.all(this.repo.db);
    const state = (r: RulesetRecord) => rulesetState(r, now);
    const live = (await this.repo.liveAt(this.repo.db, now)) ?? null;
    const drafts = all.filter((r) => state(r) === 'DRAFT');
    const liveContent = live ? await this.content(live.id) : null;
    const counts = await Promise.all(
      drafts.map(async (d) => [d.id, await this.countChanges(d.id, liveContent)] as const),
    );
    return {
      live,
      scheduled: all.find((r) => state(r) === 'SCHEDULED') ?? null,
      drafts,
      history: all
        .filter((r) => state(r) === 'CLOSED' || state(r) === 'DISCARDED')
        .sort((a, b) => this.historyTime(b) - this.historyTime(a))
        .slice(0, PRICING_EDITOR_LIMITS.historyLimit),
      changeCounts: new Map(counts),
    };
  }

  async detail(id: string): Promise<RulesetDetail> {
    const record = await this.repo.find(this.repo.db, id);
    if (!record) throw notFound();
    const content = await this.content(id);
    const isDraft = rulesetState(record, this.clock()) === 'DRAFT';
    return {
      record,
      content,
      changeCount: isDraft ? await this.countChanges(id, await this.liveContent()) : null,
    };
  }

  async diff(id: string): Promise<RulesetDiff> {
    const record = await this.repo.find(this.repo.db, id);
    if (!record) throw notFound();
    const live = await this.repo.liveAt(this.repo.db, this.clock());
    const [content, against] = await Promise.all([
      this.content(id),
      live ? this.content(live.id) : Promise.resolve(null),
    ]);
    return {
      record,
      against: live,
      liveChangedSinceCopy:
        rulesetState(record, this.clock()) === 'DRAFT' &&
        live !== null &&
        record.basedOnId !== live.id,
      rows: diffRulesets(content, against),
    };
  }

  /** Drafts awaiting publish (the Today page's count). */
  openDraftCount(): Promise<number> {
    return this.repo.openDraftCount(this.repo.db);
  }

  /**
   * The live calculator: the same request priced by the engine against this ruleset and against
   * live, as new bookings would see them (current catalogue only). Nothing is written.
   */
  async preview(id: string, q: AdminPricingPreviewQuery): Promise<AdminPricingPreview> {
    const now = this.clock();
    const record = await this.repo.find(this.repo.db, id);
    if (!record) throw notFound();
    const [city] = await this.serviceability.cities([q.cityId]);
    if (!city) throw fail(UnprocessableEntityException, 'UNKNOWN_CITY', 'Pick a city we list');
    const [ruleset, live] = await Promise.all([
      this.engineRepo.loadById(id, { activeCatalogueOnly: true }),
      this.engineRepo.loadCurrent(now),
    ]);
    if (!ruleset) throw notFound();
    const venue = {
      pincode: '',
      cityId: city.id,
      cityTier: city.tier,
      travelZone: 0 as const,
      gstStateCode: gstStateCode(city.state),
    };
    const price = (r: Ruleset): PricingPreviewResult =>
      this.previewResult(r, {
        tier: q.tier,
        categoryCode: q.categoryCode,
        venue,
        scheduledStart: new Date(q.scheduledStart),
        hours: q.hours,
        now,
        addons: q.addons.map((code) => ({ code, quantity: 1 })),
        ...(q.travelDistanceKm === undefined
          ? {}
          : { travelDistanceMetres: Math.round(q.travelDistanceKm * KM_TO_METRES) }),
      });
    const liveRecord = live ? await this.repo.find(this.repo.db, live.id) : null;
    const side = (r: Ruleset, rec: RulesetRecord): PricingPreviewSide => ({
      rulesetId: r.id,
      version: rec.publishedAt === null ? null : rec.version,
      label: rec.label,
      result: price(r),
    });
    return {
      city: { id: city.id, name: city.name, tier: city.tier },
      ruleset: side(ruleset, record),
      live: live && liveRecord ? side(live, liveRecord) : null,
    };
  }

  // ── Drafts ────────────────────────────────────────────────────────────────

  async createDraft(
    d: { readonly label: string | null; readonly fromId: string | null; readonly by: string },
    audit: AuditFor,
  ): Promise<RulesetDetail> {
    const id = randomUUID();
    const now = this.clock();
    await this.repo.begin(async (tx) => {
      await this.repo.lockLifecycle(tx);
      const source = d.fromId
        ? await this.repo.lock(tx, d.fromId)
        : await this.repo.liveAt(tx, now);
      if (!source) {
        throw d.fromId
          ? notFound()
          : fail(ConflictException, 'NO_LIVE_RULESET', 'Nothing is live to copy');
      }
      if (source.publishedAt === null) {
        throw fail(
          UnprocessableEntityException,
          'DRAFT_SOURCE_NOT_PUBLISHED',
          'Start a draft from a published version',
        );
      }
      if ((await this.repo.openDraftCount(tx)) >= PRICING_EDITOR_LIMITS.maxOpenDrafts) {
        throw fail(
          ConflictException,
          'TOO_MANY_DRAFTS',
          `There are already ${PRICING_EDITOR_LIMITS.maxOpenDrafts} drafts. Publish or discard one first.`,
        );
      }
      await this.repo.insertDraft(tx, {
        id,
        label: d.label,
        fromId: source.id,
        createdBy: d.by,
        at: now,
      });
      await this.repo.copyChildren(tx, source.id, id);
      await appendDomainEvent(tx, {
        eventType: 'pricing.draft_created',
        aggregateKind: 'pricing_ruleset',
        aggregateId: id,
        payload: { based_on_id: source.id, based_on_version: source.version, created_by: d.by },
        occurredAt: now,
      });
      await audit(id)(tx, {
        before: null,
        after: { label: d.label, based_on_id: source.id, based_on_version: source.version },
      });
    });
    return this.detail(id);
  }

  /** Applies edits to a draft, together or not at all. */
  async edit(
    id: string,
    changes: readonly ParsedChange[],
    audit: AuditFor,
  ): Promise<RulesetDetail> {
    const cityIds = changes.flatMap((c) =>
      (c.kind === 'FESTIVAL_ADD' || c.kind === 'FESTIVAL_UPDATE') && c.festival.cityId
        ? [c.festival.cityId]
        : [],
    );
    await this.assertCities(cityIds);
    await this.repo.begin(async (tx) => {
      await this.lockDraft(tx, id);
      const applied: { before: EventValue; after: EventValue }[] = [];
      for (const change of changes) applied.push(await this.apply(tx, id, change));
      await this.repo.touch(tx, id);
      await audit(id)(tx, {
        before: { changes: applied.map((a) => a.before) },
        after: { changes: applied.map((a) => a.after) },
      });
    });
    return this.detail(id);
  }

  /** Closes a draft unpublished. It stays in history; nothing is deleted. */
  async discard(id: string, by: string, audit: AuditFor): Promise<RulesetRecord> {
    const now = this.clock();
    await this.repo.begin(async (tx) => {
      await this.repo.lockLifecycle(tx);
      await this.lockDraft(tx, id);
      await this.repo.discard(tx, id, by, now);
      await appendDomainEvent(tx, {
        eventType: 'pricing.draft_discarded',
        aggregateKind: 'pricing_ruleset',
        aggregateId: id,
        payload: { discarded_by: by },
        occurredAt: now,
      });
      await audit(id)(tx, { before: { state: 'DRAFT' }, after: { state: 'DISCARDED' } });
    });
    return this.record(id);
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  /**
   * Everything a publish checks that does not need locks — run before the authenticator code is
   * spent, so a doomed publish never burns a code. publish() checks it all again under locks.
   */
  async checkPublishable(id: string, requested: Date | null, reviewedAt: Date): Promise<void> {
    const now = this.clock();
    const record = await this.repo.find(this.repo.db, id);
    this.assertPublishableDraft(record);
    this.assertReviewed(record as RulesetRecord, reviewedAt);
    this.effectiveFrom(requested, now);
    this.assertSellable(await this.content(id));
    const scheduled = (await this.repo.all(this.repo.db)).find(
      (r) => rulesetState(r, now) === 'SCHEDULED',
    );
    if (scheduled) throw this.alreadyScheduled(scheduled);
  }

  async publish(
    id: string,
    p: {
      readonly requested: Date | null;
      readonly reviewedAt: Date;
      readonly by: string;
      readonly stepUp: string;
    },
    audit: AuditFor,
  ): Promise<{ readonly published: RulesetRecord; readonly replaced: RulesetRecord | null }> {
    const replacedId = await this.repo.begin(async (tx) => {
      await this.repo.lockLifecycle(tx);
      // The time is read once the locks are held: a lock wait never closes live in the past.
      const now = this.clock();
      const draft = await this.repo.lock(tx, id);
      this.assertPublishableDraft(draft);
      this.assertReviewed(draft as RulesetRecord, p.reviewedAt);
      const at = this.effectiveFrom(p.requested, now);
      const current = await this.repo.lockOpenEnded(tx);
      if (current && current.effectiveFrom.getTime() > now.getTime()) {
        throw this.alreadyScheduled(current);
      }
      if (current && current.effectiveFrom.getTime() >= at.at.getTime()) {
        throw fail(
          ConflictException,
          'PUBLISH_CONFLICT',
          'Live pricing changed a moment ago. Refresh and try again.',
        );
      }
      const content = await this.content(id, tx);
      this.assertSellable(content);
      const base = versionFor(at.at, []);
      const version = versionFor(at.at, await this.repo.versionsOn(tx, base));
      const before = current ? await this.content(current.id, tx) : null;
      if (current) await this.repo.closeAt(tx, current.id, at.at);
      await this.repo.publish(tx, id, {
        version,
        effectiveFrom: at.at,
        publishedAt: now,
        publishedBy: p.by,
      });
      await appendDomainEvent(tx, {
        eventType: 'pricing.ruleset_published',
        aggregateKind: 'pricing_ruleset',
        aggregateId: id,
        payload: {
          version,
          effective_from: at.at.toISOString(),
          scheduled: at.scheduled,
          previous_ruleset_id: current?.id ?? null,
          previous_version: current?.version ?? null,
          published_by: p.by,
        },
        occurredAt: now,
      });
      await audit(id)(tx, {
        before: current ? asState({ ruleset: this.auditRecord(current), content: before }) : null,
        after: asState({
          ruleset: { ...this.auditRecord(draft as RulesetRecord), version, effectiveFrom: at.at },
          content,
          stepUp: p.stepUp,
        }),
      });
      return current?.id ?? null;
    });
    return {
      published: await this.record(id),
      replaced: replacedId ? await this.record(replacedId) : null,
    };
  }

  /**
   * A scheduled change that has not started goes back to being a draft and the live ruleset is
   * open-ended again. Nothing was ever priced with it (it was never effective).
   */
  async cancelSchedule(id: string, by: string, audit: AuditFor): Promise<RulesetRecord> {
    await this.repo.begin(async (tx) => {
      await this.repo.lockLifecycle(tx);
      // After the locks: a lock wait must not let a ruleset that already went live be withdrawn.
      const now = this.clock();
      const scheduled = await this.repo.lock(tx, id);
      if (!scheduled) throw notFound();
      if (rulesetState(scheduled, now) !== 'SCHEDULED') {
        throw fail(ConflictException, 'NOT_SCHEDULED', 'This version is not waiting to go live');
      }
      if (!canCancelSchedule(scheduled.effectiveFrom, now)) {
        throw fail(
          ConflictException,
          'TOO_LATE_TO_CANCEL',
          'This change goes live in a moment and can no longer be cancelled',
        );
      }
      const previous = await this.repo.lockClosedAt(tx, scheduled.effectiveFrom);
      await this.repo.unpublish(tx, id);
      if (previous) await this.repo.reopen(tx, previous.id);
      await appendDomainEvent(tx, {
        eventType: 'pricing.schedule_cancelled',
        aggregateKind: 'pricing_ruleset',
        aggregateId: id,
        payload: {
          version: scheduled.version,
          effective_from: scheduled.effectiveFrom.toISOString(),
          live_ruleset_id: previous?.id ?? null,
          cancelled_by: by,
        },
        occurredAt: now,
      });
      await audit(id)(tx, {
        before: asState({ state: 'SCHEDULED', ruleset: this.auditRecord(scheduled) }),
        after: { state: 'DRAFT', live_ruleset_id: previous?.id ?? null },
      });
    });
    return this.record(id);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async record(id: string): Promise<RulesetRecord> {
    const record = await this.repo.find(this.repo.db, id);
    if (!record) throw notFound();
    return record;
  }

  private async liveContent(): Promise<RulesetContent | null> {
    const live = await this.repo.liveAt(this.repo.db, this.clock());
    return live ? this.content(live.id) : null;
  }

  private async countChanges(id: string, live: RulesetContent | null): Promise<number> {
    return diffRulesets(await this.content(id), live).length;
  }

  private historyTime(r: RulesetRecord): number {
    return (r.discardedAt ?? r.effectiveTo ?? r.createdAt).getTime();
  }

  /** The rate card with festival city names filled in. */
  private async content(id: string, db: postgres.ISql = this.repo.db): Promise<RulesetContent> {
    const content = await this.repo.content(db, id);
    if (!content) throw notFound();
    const cityIds = content.festivals.flatMap((f) => (f.cityId ? [f.cityId] : []));
    const names = await this.serviceability.cityNames(cityIds);
    return {
      ...content,
      festivals: content.festivals.map((f) => ({
        ...f,
        cityName: f.cityId ? (names.get(f.cityId) ?? null) : null,
      })),
    };
  }

  private async lockDraft(tx: Tx, id: string): Promise<RulesetRecord> {
    const record = await this.repo.lock(tx, id);
    if (!record) throw notFound();
    if (record.discardedAt !== null) {
      throw fail(ConflictException, 'DRAFT_DISCARDED', 'This draft was discarded');
    }
    if (record.publishedAt !== null) {
      throw fail(
        ConflictException,
        'NOT_A_DRAFT',
        'A published version cannot change. Start a new draft from it.',
      );
    }
    return record;
  }

  /**
   * The authenticator code approves what the publisher reviewed: if anyone edited the draft
   * since (its updated_at moved), the publish is refused and they review again.
   */
  private assertReviewed(record: RulesetRecord, reviewedAt: Date): void {
    if (record.updatedAt.getTime() !== reviewedAt.getTime()) {
      throw fail(
        ConflictException,
        'DRAFT_CHANGED_SINCE_REVIEW',
        'This draft changed after you reviewed it. Review the changes again, then publish.',
      );
    }
  }

  private assertPublishableDraft(record: RulesetRecord | null): void {
    if (!record) throw notFound();
    if (record.discardedAt !== null) {
      throw fail(ConflictException, 'DRAFT_DISCARDED', 'This draft was discarded');
    }
    if (record.publishedAt !== null) {
      throw fail(ConflictException, 'ALREADY_PUBLISHED', 'This version is already published');
    }
  }

  private effectiveFrom(requested: Date | null, now: Date): Extract<EffectiveFrom, { ok: true }> {
    const at = resolveEffectiveFrom(requested, now);
    if (!at.ok) throw fail(UnprocessableEntityException, at.code, at.message);
    return at;
  }

  private alreadyScheduled(scheduled: RulesetRecord): HttpException {
    return fail(
      ConflictException,
      'CHANGE_ALREADY_SCHEDULED',
      `Version ${scheduled.version} is already scheduled for ${scheduled.effectiveFrom.toISOString()}. Cancel it, or publish after it goes live.`,
    );
  }

  /** Defence in depth: never publish an instantly bookable tier at ₹0 an hour. */
  private assertSellable(content: RulesetContent): void {
    const zero = content.baseRates.find((r) => !r.isQuoteOnly && r.ratePerHourPaise === 0);
    if (zero) {
      throw fail(
        UnprocessableEntityException,
        'RATE_ZERO',
        'Every bookable tier needs an hourly rate above ₹0',
      );
    }
  }

  private async assertCities(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.serviceability.cities([...new Set(ids)]);
    if (found.length !== new Set(ids).size) {
      throw fail(UnprocessableEntityException, 'UNKNOWN_CITY', 'Pick a city we list');
    }
  }

  private auditRecord(r: RulesetRecord): Record<string, unknown> {
    return {
      id: r.id,
      version: r.version,
      label: r.label,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      publishedAt: r.publishedAt,
      basedOnId: r.basedOnId,
    };
  }

  private previewResult(ruleset: Ruleset, req: Parameters<typeof computeQuote>[0]) {
    const result = computeQuote(req, ruleset);
    if (result.kind !== 'QUOTE') return result;
    return {
      ...toPriceQuote(result),
      expectedPayoutPaise: fromPaiseBigint(result.expectedPayoutPaise),
    };
  }

  private rowMissing(): HttpException {
    return fail(NotFoundException, 'ROW_NOT_FOUND', 'That row is not part of this draft');
  }

  /** One change; returns its before/after for the audit row. */
  private async apply(
    tx: Tx,
    id: string,
    c: ParsedChange,
  ): Promise<{ before: EventValue; after: EventValue }> {
    switch (c.kind) {
      case 'BASE_RATE': {
        const row = await this.repo.baseRate(tx, id, c.id);
        if (!row) throw this.rowMissing();
        if (!row.isQuoteOnly && c.ratePerHourPaise === 0) {
          throw fail(
            UnprocessableEntityException,
            'RATE_ZERO',
            'A bookable tier needs an hourly rate above ₹0',
          );
        }
        await this.repo.setBaseRate(tx, id, c.id, c.ratePerHourPaise, c.payoutShareBps);
        const ext =
          c.syncExtension !== false && c.ratePerHourPaise !== row.ratePerHourPaise
            ? await this.syncExtension(tx, id, row, c.ratePerHourPaise)
            : null;
        return {
          before: {
            kind: c.kind,
            id: c.id,
            ratePerHourPaise: row.ratePerHourPaise,
            payoutShareBps: row.payoutShareBps,
            ...(ext ? { extension: ext.before } : {}),
          },
          after: {
            kind: c.kind,
            id: c.id,
            ratePerHourPaise: c.ratePerHourPaise,
            payoutShareBps: c.payoutShareBps,
            ...(ext ? { extension: ext.after } : {}),
          },
        };
      }
      case 'CATEGORY_UPLIFT': {
        const row = await this.repo.uplift(tx, id, c.id);
        if (!row) throw this.rowMissing();
        await this.repo.setUplift(tx, id, c.id, c.multiplierBps);
        return {
          before: {
            kind: c.kind,
            id: c.id,
            category: row.categoryCode,
            multiplierBps: row.multiplierBps,
          },
          after: {
            kind: c.kind,
            id: c.id,
            category: row.categoryCode,
            multiplierBps: c.multiplierBps,
          },
        };
      }
      case 'ADDON_PRICE': {
        const row = await this.repo.addonPrice(tx, id, c.id);
        if (!row) throw this.rowMissing();
        await this.repo.setAddonPrice(tx, id, c.id, c.amountPaise);
        return {
          before: { kind: c.kind, id: c.id, addon: row.addonCode, amountPaise: row.amountPaise },
          after: { kind: c.kind, id: c.id, addon: row.addonCode, amountPaise: c.amountPaise },
        };
      }
      case 'EXTENSION_RATE': {
        const row = await this.repo.extension(tx, id, c.id);
        if (!row) throw this.rowMissing();
        await this.repo.setExtension(tx, id, c.id, c.hourlyPaise, c.waitingHourlyPaise);
        return {
          before: { kind: c.kind, ...row },
          after: {
            kind: c.kind,
            id: c.id,
            hourlyPaise: c.hourlyPaise,
            waitingHourlyPaise: c.waitingHourlyPaise,
          },
        };
      }
      case 'FESTIVAL_ADD': {
        const rowId = await this.repo.insertFestival(tx, id, c.festival);
        return { before: null, after: { kind: c.kind, id: rowId, ...c.festival } };
      }
      case 'FESTIVAL_UPDATE': {
        const row = await this.repo.festival(tx, id, c.id);
        if (!row) throw this.rowMissing();
        await this.repo.updateFestival(tx, id, c.id, c.festival);
        return {
          before: { kind: c.kind, ...row },
          after: { kind: c.kind, id: c.id, ...c.festival },
        };
      }
      case 'FESTIVAL_REMOVE': {
        const row = await this.repo.festival(tx, id, c.id);
        if (!row) throw this.rowMissing();
        await this.repo.removeFestival(tx, id, c.id);
        return {
          before: { kind: c.kind, ...row },
          after: { kind: c.kind, id: c.id, removed: true },
        };
      }
    }
  }

  /** Extension hourly follows the base rate; waiting time is its share of it (doc 05 §5). */
  private async syncExtension(
    tx: Tx,
    id: string,
    rate: {
      readonly tier: Ruleset['baseRates'][number]['tier'];
      readonly cityTier: Ruleset['baseRates'][number]['cityTier'];
    },
    newRate: number,
  ): Promise<{ before: EventValue; after: EventValue } | null> {
    const ext = await this.repo.extensionByKey(tx, id, rate.tier, rate.cityTier);
    if (!ext) return null;
    const waiting = fromPaiseBigint(roundHalfUp(BigInt(newRate) * WAITING_SHARE_BPS, BPS));
    await this.repo.setExtension(tx, id, ext.id, newRate, waiting);
    return {
      before: {
        id: ext.id,
        hourlyPaise: ext.hourlyPaise,
        waitingHourlyPaise: ext.waitingHourlyPaise,
      },
      after: { id: ext.id, hourlyPaise: newRate, waitingHourlyPaise: waiting },
    };
  }
}
