import type { AddonCode, CreateBookingBody, QuoteRequestBody } from '@clickco/contracts';
import { z } from 'zod';
import { type BookableTier, eligibleAddons, REFERENCE_CATEGORY } from '@/shared/catalogue';
import { istIso } from '@/shared/format/datetime';
import { MIN_HOURS } from './duration';
import type { Slot } from './schedule';

/** What the client is putting together. Prices are never stored here — the API quotes. */
export interface BookingDraft {
  readonly tier: BookableTier;
  readonly categoryCode: string;
  readonly pincode: string;
  readonly dateKey: string;
  readonly startMinute: number;
  readonly hours: number;
  readonly addons: readonly AddonCode[];
  readonly venueAddress: string;
  readonly venueLandmark: string;
}

export function newDraft(input: {
  readonly tier: BookableTier;
  readonly pincode: string;
  readonly slot: Slot;
  readonly categoryCode?: string;
}): BookingDraft {
  return {
    tier: input.tier,
    categoryCode: input.categoryCode ?? REFERENCE_CATEGORY,
    pincode: input.pincode,
    dateKey: input.slot.dateKey,
    startMinute: input.slot.startMinute,
    hours: MIN_HOURS,
    addons: [],
    venueAddress: '',
    venueLandmark: '',
  };
}

/** Changing tier drops add-ons the new tier cannot take (e.g. drone below Professional). */
export function withTier(draft: BookingDraft, tier: BookableTier): BookingDraft {
  const allowed = new Set(eligibleAddons(tier).map((a) => a.code));
  return { ...draft, tier, addons: draft.addons.filter((code) => allowed.has(code)) };
}

export function toggleAddon(draft: BookingDraft, code: AddonCode): BookingDraft {
  return {
    ...draft,
    addons: draft.addons.includes(code)
      ? draft.addons.filter((c) => c !== code)
      : [...draft.addons, code],
  };
}

const asAddons = (codes: readonly AddonCode[]) => codes.map((code) => ({ code, quantity: 1 }));

export function quoteRequest(draft: BookingDraft): QuoteRequestBody {
  return {
    tier: draft.tier,
    categoryCode: draft.categoryCode,
    pincode: draft.pincode,
    scheduledStart: istIso(draft.dateKey, draft.startMinute),
    hours: draft.hours,
    addons: asAddons(draft.addons),
  };
}

/** Same draft with every eligible add-on on — one quote prices all the add-on rows. */
export function addonProbeRequest(draft: BookingDraft): QuoteRequestBody {
  return {
    ...quoteRequest(draft),
    addons: asAddons(eligibleAddons(draft.tier).map((a) => a.code)),
  };
}

/** Home's "from ₹X / 2 hrs": the reference category, 2 hours, no add-ons. */
export function referenceRequest(
  tier: BookableTier,
  pincode: string,
  slot: Slot,
): QuoteRequestBody {
  return quoteRequest(newDraft({ tier, pincode, slot }));
}

export const VenueForm = z.object({
  venueAddress: z
    .string()
    .trim()
    .min(5, 'Add the venue address — building, street and area')
    .max(500, 'Keep the address under 500 characters'),
  venueLandmark: z.string().trim().max(200, 'Keep the landmark under 200 characters'),
});
export type VenueForm = z.infer<typeof VenueForm>;

export const CheckoutForm = z.object({
  bookerName: z.string().trim().min(1, 'Add your name').max(120, 'That name is too long'),
  acceptTerms: z.boolean().refine((v) => v, 'Accept the terms to continue'),
  /** Opt-in, never defaulted (T&C §7, DOMAIN consent rules). */
  modelReleaseConsent: z.boolean(),
});
export type CheckoutForm = z.infer<typeof CheckoutForm>;

export interface Booker {
  readonly name: string;
  readonly phone: string;
}

/** The POST /bookings body. The server re-prices from these inputs; no total is ever sent. */
export function createBookingBody(
  draft: BookingDraft,
  booker: Booker,
  consent: { readonly modelReleaseConsent: boolean; readonly termsVersion: string },
): CreateBookingBody {
  const landmark = draft.venueLandmark.trim();
  return {
    ...quoteRequest(draft),
    tier: draft.tier,
    venueAddress: draft.venueAddress.trim(),
    ...(landmark === '' ? {} : { venueLandmark: landmark }),
    booker: { name: booker.name.trim(), phone: booker.phone },
    galleryRecipient: 'BOOKER',
    modelReleaseConsent: consent.modelReleaseConsent,
    acceptedTermsVersion: consent.termsVersion,
  };
}
