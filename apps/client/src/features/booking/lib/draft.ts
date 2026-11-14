import type { AddonCode, CreateBookingBody, QuoteRequestBody } from '@clickco/contracts';
import { z } from 'zod';
import {
  type AddonInfo,
  addonInfo,
  type BookableTier,
  eligibleAddons,
  REELS_MAX,
  REFERENCE_CATEGORY,
} from '@/shared/catalogue';
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
  /** On/off add-ons. Reels are a count, kept in `reels`, never here. */
  readonly addons: readonly AddonCode[];
  /** Reels ordered (ADR-0034); 0 = none. Only with the videographer on. */
  readonly reels: number;
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
    reels: 0,
    venueAddress: '',
    venueLandmark: '',
  };
}

const REELS: AddonCode = 'REELS';

/** A draft persisted before ADR-0034 (store v1) has no reel count: it resumes with none. */
export function upgradeDraft(
  draft: (Omit<BookingDraft, 'reels'> & { readonly reels?: number }) | null,
  fromVersion: number,
): BookingDraft | null {
  if (draft === null) return null;
  if (fromVersion >= 2 && draft.reels !== undefined) return draft as BookingDraft;
  return { ...draft, reels: draft.reels ?? 0 };
}

/** Keeps only add-ons whose parent (if any) is still on; reels go with the videographer. */
function withDependants(draft: BookingDraft, addons: readonly AddonCode[]): BookingDraft {
  const kept = addons.filter((code) => {
    const parent = addonInfo(code)?.requires;
    return parent === undefined || addons.includes(parent);
  });
  const reelsParent = addonInfo(REELS)?.requires;
  const reelsAllowed = reelsParent === undefined || kept.includes(reelsParent);
  return { ...draft, addons: kept, reels: reelsAllowed ? draft.reels : 0 };
}

/** Changing tier drops add-ons the new tier cannot take (e.g. drone below Professional). */
export function withTier(draft: BookingDraft, tier: BookableTier): BookingDraft {
  const allowed = new Set(eligibleAddons(tier).map((a) => a.code));
  const reels = allowed.has(REELS) ? draft.reels : 0;
  return withDependants(
    { ...draft, tier, reels },
    draft.addons.filter((code) => allowed.has(code)),
  );
}

/** On/off add-ons. One that needs another stays off until that one is on; turning a parent off
 * drops what hangs off it (no reels or raw footage without the videographer). */
export function toggleAddon(draft: BookingDraft, code: AddonCode): BookingDraft {
  const info = addonInfo(code);
  if (info?.maxCount !== undefined) return draft;
  if (draft.addons.includes(code)) {
    return withDependants(
      draft,
      draft.addons.filter((c) => c !== code),
    );
  }
  if (info?.requires !== undefined && !draft.addons.includes(info.requires)) return draft;
  return { ...draft, addons: [...draft.addons, code] };
}

/** Sets the reel count, whole and within 0…REELS_MAX; 0 unless the videographer is on. */
export function setReels(draft: BookingDraft, count: number): BookingDraft {
  const parent = addonInfo(REELS)?.requires;
  if (parent !== undefined && !draft.addons.includes(parent)) return { ...draft, reels: 0 };
  const whole = Number.isFinite(count) ? Math.floor(count) : 0;
  return { ...draft, reels: Math.min(REELS_MAX, Math.max(0, whole)) };
}

function asAddons(draft: BookingDraft) {
  const switches = draft.addons.map((code) => ({ code, quantity: 1 }));
  return draft.reels > 0 ? [...switches, { code: REELS, quantity: draft.reels }] : switches;
}

export function quoteRequest(draft: BookingDraft): QuoteRequestBody {
  return {
    tier: draft.tier,
    categoryCode: draft.categoryCode,
    pincode: draft.pincode,
    scheduledStart: istIso(draft.dateKey, draft.startMinute),
    hours: draft.hours,
    addons: asAddons(draft),
  };
}

const probeQuantity = (addon: AddonInfo, draft: BookingDraft): number =>
  addon.maxCount === undefined ? 1 : Math.max(1, draft.reels);

/**
 * Same draft with every eligible add-on on — one quote prices all the add-on rows. A counted
 * add-on is asked for at the draft's count (at least 1), so the server prices its quantity break.
 */
export function addonProbeRequest(draft: BookingDraft): QuoteRequestBody {
  return {
    ...quoteRequest(draft),
    addons: eligibleAddons(draft.tier).map((a) => ({
      code: a.code,
      quantity: probeQuantity(a, draft),
    })),
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
