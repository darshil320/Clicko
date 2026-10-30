import type {
  PlanTier,
  PricingAddonPriceRow,
  PricingBaseRateRow,
  PricingCategoryUpliftRow,
  PricingEmergencyRow,
  PricingExtensionRateRow,
  PricingFestivalRow,
  PricingTimeRow,
  PricingTravelSlabRow,
} from '@clickco/contracts';

/** What each tier promises (plan_deliverables): copied with the ruleset, not edited here. */
export type DeliverableContent = {
  readonly tier: PlanTier;
  readonly framesPerHour: number;
  readonly gearClass: string;
  readonly dualCardRequired: boolean;
  readonly secondShooterIncluded: boolean;
  readonly rawIncluded: boolean;
  readonly jpegIncluded: boolean;
  readonly videoIncluded: boolean;
  readonly editIncluded: boolean;
  readonly deliveryHours: number;
  readonly minHours: number;
  readonly isInstantBookable: boolean;
};

export type RulesetSettings = {
  readonly pricesIncludeGst: boolean;
  readonly gstRateBps: number;
  readonly sacCode: string;
};

/**
 * Everything one ruleset prices with (schema §5), money as integer paise numbers (ADR-0007).
 * The editor's view, the diff and the publish audit row all read this one shape.
 */
export type RulesetContent = {
  readonly settings: RulesetSettings;
  readonly baseRates: readonly PricingBaseRateRow[];
  readonly categoryUplifts: readonly PricingCategoryUpliftRow[];
  readonly addonPrices: readonly PricingAddonPriceRow[];
  readonly extensionRates: readonly PricingExtensionRateRow[];
  readonly festivals: readonly PricingFestivalRow[];
  readonly emergency: readonly PricingEmergencyRow[];
  readonly timeMultipliers: readonly PricingTimeRow[];
  readonly travelSlabs: readonly PricingTravelSlabRow[];
  readonly deliverables: readonly DeliverableContent[];
};

/** A pricing_rulesets row (schema §5 + addendum 0010). */
export type RulesetRecord = {
  readonly id: string;
  readonly version: string;
  readonly label: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
  readonly createdAt: Date;
  readonly createdBy: string | null;
  readonly updatedAt: Date;
  readonly discardedAt: Date | null;
  readonly discardedBy: string | null;
  readonly basedOnId: string | null;
  readonly basedOnVersion: string | null;
};
