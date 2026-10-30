import type {
  AdminPricingDiff,
  AdminPricingOverview,
  AdminPricingPreview,
  AdminPricingPreviewQuery,
  AdminPricingPublishResponse,
  AdminPricingRuleset,
  AdminPricingRulesetChange,
  AdminPricingCreateDraftBody as CreateSchema,
  AdminPricingEditBody as EditSchema,
  PricingRulesetSummary,
  AdminPricingPublishBody as PublishSchema,
} from '@clickco/contracts';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import { SQL } from '../../../infra/db/db.module';
import { isDraftWindow, rulesetState } from '../../pricing/editor/lifecycle';
import type { RulesetRecord } from '../../pricing/editor/ruleset-content';
import {
  type AuditFor,
  type RulesetDetail,
  RulesetEditorService,
} from '../../pricing/ruleset-editor.service';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { STEP_UP_METHOD, StepUpService } from '../auth/step-up.service';
import { OverviewRegistry } from '../overview/overview.registry';
import { isAre, plural } from '../overview/overview-source';
import { StaffRepository } from '../staff/staff.repository';

/** Parsed bodies (defaults applied by the controller's ZodValidationPipe). */
export type CreateBody = z.output<typeof CreateSchema>;
export type EditBody = z.output<typeof EditSchema>;
export type PublishBody = z.output<typeof PublishSchema>;

/** Who may change prices (ADR-0026 D4). SUPER_ADMIN passes every role check (ADR-0025 D3). */
export const PRICING_EDITOR_ROLES = ['FINANCE'] as const;

const ENTITY = 'pricing_ruleset';
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/**
 * The pricing desk (ADR-0026 D4): the overview, drafts, the calculator, the diff and the
 * step-up publish. The pricing module decides; this desk adds staff names, the audit hook and
 * the authenticator check. Its Today count is the drafts awaiting publish.
 */
@Injectable()
export class PricingDeskService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RulesetEditorService) private readonly editor: RulesetEditorService,
    @Inject(StaffRepository) private readonly staff: StaffRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
    @Inject(OverviewRegistry) overview: OverviewRegistry,
  ) {
    overview.register({
      key: 'pricing.drafts_awaiting_publish',
      desk: 'pricing',
      // Only the people who can publish are asked to act on a draft.
      count: ({ caller }) =>
        caller.grants.some(
          (g) => g.role === 'SUPER_ADMIN' || (g.role === 'FINANCE' && g.cityId === null),
        )
          ? this.overviewCount()
          : Promise.resolve(0),
      needsYou: {
        tone: 'attention',
        title: 'Price changes to publish',
        line: (n) =>
          `${plural(n, 'pricing draft')} ${isAre(n)} waiting to be reviewed and published.`,
        action: 'Open pricing',
      },
    });
  }

  /** Today's "Needs you" count: drafts awaiting publish (ADR-0026 D8). */
  overviewCount(): Promise<number> {
    return this.editor.openDraftCount();
  }

  async overview(): Promise<AdminPricingOverview> {
    const o = await this.editor.overview();
    const all = [o.live, o.scheduled, ...o.drafts, ...o.history].filter(
      (r): r is RulesetRecord => r !== null,
    );
    const names = await this.names(all);
    const summary = (r: RulesetRecord) => this.summary(r, names, o.changeCounts.get(r.id) ?? null);
    return {
      live: o.live ? summary(o.live) : null,
      scheduled: o.scheduled ? summary(o.scheduled) : null,
      drafts: o.drafts.map(summary),
      history: o.history.map(summary),
    };
  }

  async detail(id: string): Promise<AdminPricingRuleset> {
    return this.view(await this.editor.detail(id));
  }

  async createDraft(
    caller: StaffCaller,
    ctx: AuditContext,
    body: CreateBody,
  ): Promise<AdminPricingRuleset> {
    this.assertNationwide(caller);
    const detail = await this.editor.createDraft(
      { label: body.label, fromId: body.fromRulesetId, by: caller.id },
      this.auditFor(ctx),
    );
    return this.view(detail);
  }

  async edit(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: EditBody,
  ): Promise<AdminPricingRuleset> {
    this.assertNationwide(caller);
    return this.view(await this.editor.edit(id, body.changes, this.auditFor(ctx)));
  }

  async discard(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
  ): Promise<AdminPricingRulesetChange> {
    this.assertNationwide(caller);
    const record = await this.editor.discard(id, caller.id, this.auditFor(ctx));
    return { ruleset: this.summary(record, await this.names([record]), null) };
  }

  async diff(id: string): Promise<AdminPricingDiff> {
    const d = await this.editor.diff(id);
    return {
      ruleset: {
        id: d.record.id,
        label: d.record.label,
        basedOn:
          d.record.basedOnId && d.record.basedOnVersion
            ? { id: d.record.basedOnId, version: d.record.basedOnVersion }
            : null,
      },
      against: d.against ? { id: d.against.id, version: d.against.version } : null,
      liveChangedSinceCopy: d.liveChangedSinceCopy,
      rows: [...d.rows],
    };
  }

  preview(id: string, query: AdminPricingPreviewQuery): Promise<AdminPricingPreview> {
    return this.editor.preview(id, query);
  }

  /**
   * FINANCE / SUPER_ADMIN (the route's roles) + a fresh authenticator code. Cheap checks run
   * first, so a publish that would fail anyway never spends the code.
   */
  async publish(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: PublishBody,
  ): Promise<AdminPricingPublishResponse> {
    this.assertNationwide(caller);
    const requested = body.effectiveFrom === null ? null : new Date(body.effectiveFrom);
    const reviewedAt = new Date(body.expectedUpdatedAt);
    await this.editor.checkPublishable(id, requested, reviewedAt);
    await this.stepUp.verify(caller.id, body.code, ctx, 'pricing.publish');
    const result = await this.editor.publish(
      id,
      { requested, reviewedAt, by: caller.id, stepUp: STEP_UP_METHOD },
      this.auditFor(ctx),
    );
    const names = await this.names([
      result.published,
      ...(result.replaced ? [result.replaced] : []),
    ]);
    return {
      published: this.summary(result.published, names, null),
      replaced: result.replaced ? this.summary(result.replaced, names, null) : null,
    };
  }

  async cancelSchedule(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
  ): Promise<AdminPricingRulesetChange> {
    this.assertNationwide(caller);
    const record = await this.editor.cancelSchedule(id, caller.id, this.auditFor(ctx));
    return { ruleset: this.summary(record, await this.names([record]), null) };
  }

  /**
   * Prices apply in every city, so only an all-cities grant may change them: a FINANCE grant
   * limited to one city can view but not edit (StaffGuard has already required FINANCE or
   * SUPER_ADMIN; SUPER_ADMIN is always 'ALL').
   */
  private assertNationwide(caller: StaffCaller): void {
    if (caller.scope !== 'ALL') {
      throw new ForbiddenException({
        code: 'PRICING_NEEDS_ALL_CITIES',
        message:
          'Prices apply in every city: only finance with access to all cities can change them',
      });
    }
  }

  private auditFor(ctx: AuditContext): AuditFor {
    return (rulesetId) => this.audit.hook(ctx, ENTITY, rulesetId);
  }

  private async view(d: RulesetDetail): Promise<AdminPricingRuleset> {
    const names = await this.names([d.record]);
    const { content } = d;
    return {
      summary: this.summary(d.record, names, d.changeCount),
      pricesIncludeGst: content.settings.pricesIncludeGst,
      gstRateBps: content.settings.gstRateBps,
      sacCode: content.settings.sacCode,
      baseRates: [...content.baseRates],
      categoryUplifts: [...content.categoryUplifts],
      addonPrices: [...content.addonPrices],
      extensionRates: [...content.extensionRates],
      festivals: [...content.festivals],
      emergency: [...content.emergency],
      timeMultipliers: content.timeMultipliers.map((t) => ({
        ...t,
        isoDays: t.isoDays ? [...t.isoDays] : null,
      })),
      travelSlabs: [...content.travelSlabs],
    };
  }

  /** Staff display names (admin owns staff_users); a handful of finance people at most. */
  private async names(records: readonly RulesetRecord[]): Promise<ReadonlyMap<string, string>> {
    const ids = [
      ...new Set(
        records.flatMap((r) =>
          [r.createdBy, r.publishedBy, r.discardedBy].filter((x): x is string => x !== null),
        ),
      ),
    ];
    const found = await Promise.all(ids.map((id) => this.staff.findById(this.sql, id)));
    return new Map(found.flatMap((s) => (s ? ([[s.id, s.fullName]] as [string, string][]) : [])));
  }

  private summary(
    r: RulesetRecord,
    names: ReadonlyMap<string, string>,
    changeCount: number | null,
  ): PricingRulesetSummary {
    const state = rulesetState(r, this.clock());
    const published = r.publishedAt !== null && !isDraftWindow(r.effectiveFrom);
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      id: r.id,
      state,
      version: published ? r.version : null,
      label: r.label,
      effectiveFrom: published ? iso(r.effectiveFrom) : null,
      effectiveTo: published ? iso(r.effectiveTo) : null,
      publishedAt: iso(r.publishedAt),
      publishedBy: name(r.publishedBy),
      createdAt: r.createdAt.toISOString(),
      createdBy: name(r.createdBy),
      updatedAt: r.updatedAt.toISOString(),
      discardedAt: iso(r.discardedAt),
      discardedBy: name(r.discardedBy),
      basedOn:
        r.basedOnId && r.basedOnVersion ? { id: r.basedOnId, version: r.basedOnVersion } : null,
      changeCount: state === 'DRAFT' ? changeCount : null,
    };
  }
}
