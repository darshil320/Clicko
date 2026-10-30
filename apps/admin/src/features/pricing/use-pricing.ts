'use client';

import type {
  AdminPricingRuleset,
  CityTier,
  PlanTier,
  PricingDraftChange,
} from '@clickco/contracts';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { useAdminMutation } from '../../shared/mutation';
import { keys } from '../../shared/query';

/** The pricing desk's query keys (one prefix, so a change refreshes everything it touched). */
export const pricingKeys = {
  all: ['pricing'] as const,
  overview: ['pricing', 'overview'] as const,
  ruleset: (id: string) => ['pricing', 'ruleset', id] as const,
  diff: (id: string) => ['pricing', 'diff', id] as const,
  preview: (id: string, input: unknown) => ['pricing', 'preview', id, input] as const,
};

export const TIER_LABEL: Readonly<Record<PlanTier, string>> = {
  BASIC: 'Basic',
  SEMI_PRO: 'Semi-pro',
  PROFESSIONAL: 'Professional',
  EXPERT: 'Expert',
  SIGNATURE: 'Signature',
};

export const CITY_TIER_LABEL: Readonly<Record<CityTier, string>> = {
  METRO: 'Metro',
  TIER_1: 'Tier 1',
  TIER_2: 'Tier 2',
  TIER_3: 'Tier 3',
};

export const CITY_TIERS: readonly CityTier[] = ['METRO', 'TIER_1', 'TIER_2', 'TIER_3'];

/**
 * Who may change prices: FINANCE or SUPER_ADMIN (ADR-0026 D4). The UI only hides what the API
 * would refuse; the API decides.
 */
export function useCanEditPricing(): boolean {
  const me = useQuery({ queryKey: keys.me, queryFn: () => adminApi.me() });
  // Prices apply in every city: a city-limited finance grant views only (the API refuses edits).
  return (me.data?.grants ?? []).some(
    (g) => g.role === 'SUPER_ADMIN' || (g.role === 'FINANCE' && g.cityId === null),
  );
}

export function usePricingOverview() {
  return useQuery({ queryKey: pricingKeys.overview, queryFn: () => adminApi.pricing.overview() });
}

export function useRuleset(id: string) {
  return useQuery({ queryKey: pricingKeys.ruleset(id), queryFn: () => adminApi.pricing.get(id) });
}

export function useDiff(id: string, enabled = true) {
  return useQuery({
    queryKey: pricingKeys.diff(id),
    queryFn: () => adminApi.pricing.diff(id),
    enabled,
  });
}

/**
 * Saves edits to a draft. Inline cells await `save` and show its error under the cell, so the
 * toast stays quiet on failure there; the success toast names what changed.
 */
export function useDraftEdit(rulesetId: string) {
  const mutation = useAdminMutation({
    run: (vars: { changes: PricingDraftChange[]; what: string }, idem) =>
      adminApi.pricing.edit(rulesetId, { changes: vars.changes }, idem),
    success: (vars) => `Saved — ${vars.what}`,
    invalidate: [pricingKeys.all],
  });
  /** null when saved, else the message to show next to the field. */
  const save = async (changes: PricingDraftChange[], what: string): Promise<string | null> => {
    try {
      await mutation.mutateAsync({ changes, what });
      return null;
    } catch (error) {
      return describeError(error).message;
    }
  };
  return { save, isPending: mutation.isPending };
}

export type Ruleset = AdminPricingRuleset;
