import { z } from 'zod';
import { IsoDateTime } from './common.js';
import { CityTier, PlanTier } from './enums.js';
import { BasisPoints, Hours, MoneyPaise } from './money.js';

/**
 * Mirror of booking_price_snapshots (schema §7). Immutable once written: an
 * extension is a new `sequence`, never an edit. The CHECKs below repeat the
 * table's snapshot_totals_balance / snapshot_total_check constraints.
 */
export const PriceSnapshot = z
  .object({
    rulesetVersion: z.string().min(1),
    sequence: z.int().min(1),
    tier: PlanTier,
    cityTier: CityTier,
    categoryCode: z.string().min(1),
    hours: Hours,

    baseRatePerHourPaise: MoneyPaise,
    categoryUpliftBps: BasisPoints,
    emergencyMultiplierBps: BasisPoints,
    surgeMultiplierBps: BasisPoints,
    nightMultiplierBps: BasisPoints,
    weekendMultiplierBps: BasisPoints,

    baseAmountPaise: MoneyPaise,
    addonsAmountPaise: MoneyPaise,
    travelAmountPaise: MoneyPaise,
    discountAmountPaise: MoneyPaise,
    taxableAmountPaise: MoneyPaise,
    gstRateBps: BasisPoints,
    gstAmountPaise: MoneyPaise,
    totalAmountPaise: MoneyPaise,
    pricesIncludeGst: z.boolean(),

    payoutShareBps: BasisPoints,
    expectedPayoutPaise: MoneyPaise,

    promoCode: z.string().nullable(),
    computedAt: IsoDateTime,
  })
  .refine(
    (s) =>
      s.taxableAmountPaise ===
      s.baseAmountPaise + s.addonsAmountPaise + s.travelAmountPaise - s.discountAmountPaise,
    {
      message: 'taxable must equal base + addons + travel - discount',
      path: ['taxableAmountPaise'],
    },
  )
  .refine((s) => s.totalAmountPaise === s.taxableAmountPaise + s.gstAmountPaise, {
    message: 'total must equal taxable + GST',
    path: ['totalAmountPaise'],
  });
export type PriceSnapshot = z.infer<typeof PriceSnapshot>;
