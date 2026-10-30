import {
  AdminPricingCreateDraftBody,
  AdminPricingDiff,
  AdminPricingEditBody,
  AdminPricingOverview,
  AdminPricingPreview,
  AdminPricingPreviewQuery,
  AdminPricingPublishBody,
  AdminPricingPublishResponse,
  AdminPricingRuleset,
  AdminPricingRulesetChange,
} from '@clickco/contracts';
import type { z } from 'zod';
import { type AdminRequests, checked, idSegment } from './admin-http.js';
import type { Idempotent } from './client.js';

/** What the calculator asks for (validated before it leaves the browser). */
export type AdminPricingPreviewInput = z.input<typeof AdminPricingPreviewQuery>;

/** The calculator's query string: `addon` repeats; optional distance only when given. */
export function pricingPreviewParams(input: AdminPricingPreviewInput): URLSearchParams {
  const q = checked(AdminPricingPreviewQuery, input);
  const params = new URLSearchParams({
    tier: q.tier,
    categoryCode: q.categoryCode,
    cityId: q.cityId,
    hours: String(q.hours),
    scheduledStart: q.scheduledStart,
  });
  for (const addon of q.addons) params.append('addons', addon);
  if (q.travelDistanceKm !== undefined) params.set('travelDistanceKm', String(q.travelDistanceKm));
  return params;
}

const base = (id: string) => `/admin/pricing/rulesets/${idSegment(id)}`;

/**
 * ADR-0026 stream D — `/admin/pricing` (the pricing editor, D4). Viewing: finance, city managers,
 * read-only. Drafting and publishing: finance (and super admin); a publish carries a fresh
 * authenticator code. Every POST takes an Idempotency-Key — one per intent.
 */
export function adminPricingRoutes(r: AdminRequests) {
  return {
    /** Live, scheduled, drafts and history. */
    overview: () => r.get('/admin/pricing/rulesets', AdminPricingOverview),
    /** The whole rate card of one version or draft. */
    get: (rulesetId: string) => r.get(base(rulesetId), AdminPricingRuleset),
    /** A full copy of the live version (or `fromRulesetId`, to roll back). */
    createDraft: (body: AdminPricingCreateDraftBody, idem: Idempotent) =>
      r.post(
        '/admin/pricing/rulesets/drafts',
        AdminPricingRuleset,
        idem,
        checked(AdminPricingCreateDraftBody, body),
      ),
    /** Applies edits to a draft, together or not at all. */
    edit: (rulesetId: string, body: AdminPricingEditBody, idem: Idempotent) =>
      r.post(
        `${base(rulesetId)}/edits`,
        AdminPricingRuleset,
        idem,
        checked(AdminPricingEditBody, body),
      ),
    /** Closes a draft without publishing it (it stays in history). */
    discard: (rulesetId: string, idem: Idempotent) =>
      r.post(`${base(rulesetId)}/discard`, AdminPricingRulesetChange, idem),
    /** Every row that differs from the live version. */
    diff: (rulesetId: string) => r.get(`${base(rulesetId)}/diff`, AdminPricingDiff),
    /** One quote on this version and on live, side by side. Creates nothing. */
    preview: (rulesetId: string, input: AdminPricingPreviewInput) =>
      r.get(`${base(rulesetId)}/preview`, AdminPricingPreview, pricingPreviewParams(input)),
    /** Publish now (`effectiveFrom: null`) or at a later instant, with the authenticator code. */
    publish: (rulesetId: string, body: AdminPricingPublishBody, idem: Idempotent) =>
      r.post(
        `${base(rulesetId)}/publish`,
        AdminPricingPublishResponse,
        idem,
        checked(AdminPricingPublishBody, body),
      ),
    /** A scheduled change that has not started goes back to being a draft. */
    cancelSchedule: (rulesetId: string, idem: Idempotent) =>
      r.post(`${base(rulesetId)}/cancel-schedule`, AdminPricingRulesetChange, idem),
  };
}
