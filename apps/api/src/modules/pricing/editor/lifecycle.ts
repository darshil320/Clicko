import {
  PRICING_EDITOR_LIMITS,
  type PricingRulesetState,
  pricingVersionFor,
} from '@clickco/contracts';
import { toIst } from '../engine/ist-time';

/**
 * A ruleset's life (doc 05 §11, ADR-0026 D4) as pure rules: draft → published (scheduled or
 * live) → closed by the next publish; or draft → discarded. Never deleted.
 */

/**
 * Addendum 0010: an unpublished ruleset carries this fixed window — the first microsecond of
 * 1970 — because the schema needs a NOT NULL effective_from and allows only one open-ended row.
 * No quote is ever priced at it, and loadCurrent only reads published rows anyway. SQL literals,
 * never parameters: a JS Date has no microseconds.
 */
export const DRAFT_EFFECTIVE_FROM_SQL = "TIMESTAMPTZ '1970-01-01 00:00:00+00'";
export const DRAFT_EFFECTIVE_TO_SQL = "TIMESTAMPTZ '1970-01-01 00:00:00.000001+00'";
export const DRAFT_EFFECTIVE_FROM = new Date(0);

export const isDraftWindow = (effectiveFrom: Date): boolean => effectiveFrom.getTime() === 0;

/** A draft's version until it is published (the column is NOT NULL and unique). */
export const draftVersion = (id: string): string => `draft-${id}`;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface LifecycleFacts {
  readonly publishedAt: Date | null;
  readonly discardedAt: Date | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** Inclusive start, exclusive end — the same window the engine resolves (doc 05 step 1). */
export function rulesetState(r: LifecycleFacts, now: Date): PricingRulesetState {
  if (r.discardedAt !== null) return 'DISCARDED';
  if (r.publishedAt === null) return 'DRAFT';
  if (r.effectiveFrom.getTime() > now.getTime()) return 'SCHEDULED';
  if (r.effectiveTo !== null && r.effectiveTo.getTime() <= now.getTime()) return 'CLOSED';
  return 'LIVE';
}

export type EffectiveFrom =
  | { readonly ok: true; readonly at: Date; readonly scheduled: boolean }
  | {
      readonly ok: false;
      readonly code: 'EFFECTIVE_FROM_PAST' | 'EFFECTIVE_FROM_TOO_FAR';
      readonly message: string;
    };

/** null = now. A later instant schedules the change, at most maxScheduleDays ahead. */
export function resolveEffectiveFrom(requested: Date | null, now: Date): EffectiveFrom {
  if (requested === null || requested.getTime() === now.getTime()) {
    return { ok: true, at: now, scheduled: false };
  }
  if (requested.getTime() < now.getTime()) {
    return {
      ok: false,
      code: 'EFFECTIVE_FROM_PAST',
      message: 'That time has passed. Publish now or pick a later time.',
    };
  }
  if (requested.getTime() - now.getTime() > PRICING_EDITOR_LIMITS.maxScheduleDays * DAY_MS) {
    return {
      ok: false,
      code: 'EFFECTIVE_FROM_TOO_FAR',
      message: `A change can be scheduled up to ${PRICING_EDITOR_LIMITS.maxScheduleDays} days ahead.`,
    };
  }
  return { ok: true, at: requested, scheduled: true };
}

/** '2026.11.01' for a ruleset starting on 1 Nov (IST), suffixed when that day is taken. */
export function versionFor(effectiveFrom: Date, taken: Iterable<string>): string {
  return pricingVersionFor(toIst(effectiveFrom).isoDate, taken);
}

/** A scheduled change can be withdrawn until shortly before it starts (server clock skew). */
export function canCancelSchedule(effectiveFrom: Date, now: Date): boolean {
  return (
    effectiveFrom.getTime() - now.getTime() > PRICING_EDITOR_LIMITS.cancelCutoffMinutes * MINUTE_MS
  );
}
