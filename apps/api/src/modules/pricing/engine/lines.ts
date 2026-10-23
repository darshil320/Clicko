/** Client-facing line items (doc 05 §7). Labels are display text; amounts stay bigint paise. */
import type { EmergencyBand, PlanTier } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';
import type { PricedAddon } from './addons';
import { NEUTRAL_BPS } from './constants';
import type { PricedTravel } from './travel';
import type { Quote, QuoteLine } from './types';

export const TIER_LABEL: Readonly<Record<PlanTier, string>> = {
  BASIC: 'Basic',
  SEMI_PRO: 'Semi-Pro',
  PROFESSIONAL: 'Professional',
  EXPERT: 'Expert',
  SIGNATURE: 'Signature',
};

const BAND_LABEL: Readonly<Record<EmergencyBand, string>> = {
  NONE: 'Standard booking',
  NEXT_DAY: 'Next-day booking',
  SAME_DAY: 'Same-day booking',
  HOURS_3_8: 'Urgent booking (3–8 hours)',
  HOURS_UNDER_3: 'Emergency booking (under 3 hours)',
};

const KM_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** 'REAL_ESTATE' → 'Real Estate'. */
export function categoryName(code: string): string {
  return code
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/** ₹4,250 for whole rupees, ₹4,250.50 otherwise. */
export const rupees = (paise: bigint): string =>
  formatINR(paise, { showPaise: paise % 100n !== 0n });

export interface LineInput {
  readonly tier: PlanTier;
  readonly categoryCode: string;
  readonly hours: number;
  readonly baseRatePerHourPaise: bigint;
  readonly baseAmountPaise: bigint;
  readonly factors: Quote['factors'];
  readonly emergencyBand: EmergencyBand;
  readonly surgeLabel: string | null;
  readonly addons: readonly PricedAddon[];
  readonly travel: PricedTravel;
  readonly discountPaise: bigint;
  readonly promoCode: string | null;
}

function baseLine(input: LineInput): QuoteLine {
  const { tier, categoryCode, hours } = input;
  return {
    code: 'BASE',
    label: `${TIER_LABEL[tier]} · ${categoryName(categoryCode)} · ${hours} hours`,
    detail: `${rupees(input.baseRatePerHourPaise)}/hr × ${hours} hrs`,
    amountPaise: input.baseAmountPaise,
  };
}

/** One line per factor that moved the base (≠ 1.00×). All values stay in factorsApplied too. */
function factorLines(input: LineInput): QuoteLine[] {
  const { factors } = input;
  const candidates: ReadonlyArray<readonly [string, string, number]> = [
    ['EMERGENCY', BAND_LABEL[input.emergencyBand], factors.emergencyBps],
    ['SURGE', input.surgeLabel ?? 'Peak demand', factors.surgeBps],
    ['NIGHT', 'Night shoot', factors.nightBps],
    ['WEEKEND', 'Weekend', factors.weekendBps],
    ['CATEGORY', `${categoryName(input.categoryCode)} category`, factors.categoryUpliftBps],
  ];
  return candidates
    .filter(([, , bps]) => bps !== NEUTRAL_BPS)
    .map(([code, label, factorBps]) => ({ code, label, isFactor: true, factorBps }));
}

function addonDetail(addon: PricedAddon, hours: number): string | undefined {
  const qty = addon.quantity > 1 ? ` × ${addon.quantity}` : '';
  if (addon.isPerHour) return `${rupees(addon.unitPaise)}/hr × ${hours} hrs${qty}`;
  return qty === '' ? undefined : `${rupees(addon.unitPaise)}${qty}`;
}

function addonLine(addon: PricedAddon, hours: number): QuoteLine {
  const detail = addonDetail(addon, hours);
  const line = { code: `ADDON_${addon.code}`, label: addon.label, amountPaise: addon.amountPaise };
  return detail === undefined ? line : { ...line, detail };
}

function travelLines(travel: PricedTravel): QuoteLine[] {
  if (travel.amountPaise === 0n) return [];
  const km = KM_FORMAT.format(travel.distanceMetres / 1000);
  return [
    {
      code: 'TRAVEL',
      label: travel.isMeasured ? `Travel (${km} km)` : 'Travel',
      detail: `Zone ${travel.zone}`,
      amountPaise: travel.amountPaise,
    },
  ];
}

function discountLines(discountPaise: bigint, promoCode: string | null): QuoteLine[] {
  if (discountPaise === 0n || promoCode === null) return [];
  return [{ code: 'DISCOUNT', label: promoCode, amountPaise: -discountPaise }];
}

export function buildLines(input: LineInput): readonly QuoteLine[] {
  return [
    baseLine(input),
    ...factorLines(input),
    ...input.addons.map((addon) => addonLine(addon, input.hours)),
    ...travelLines(input.travel),
    ...discountLines(input.discountPaise, input.promoCode),
  ];
}
