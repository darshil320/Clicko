import { z } from 'zod';
import { BookingStatus, EmergencyBand, PlanTier } from './enums.js';

/**
 * ADR-0029 D4: the product-analytics event catalogue — the ONLY events and properties the apps
 * may send (PostHog once approved; a no-op adapter until then). Rules:
 * - no personal data: no names, phones, emails, addresses, pincodes, coordinates, free text,
 *   booking references or ids. Events are anonymous per install; the apps never `identify`.
 * - every property object is strict: an unknown key fails validation and the event is dropped;
 * - every string is an enum or a short upper-case code, so nothing typed by a person can pass;
 * - money is a coarse band (`priceBand`), never an amount.
 * Adding an event: add it here (with a test), then call `track` from the app's shared/analytics.
 */

const CategoryCode = z.string().regex(/^[A-Z_]{2,32}$/);
const Hours = z.number().min(2).max(24);

/** Coarse price bands (integer paise boundaries): enough for funnel analysis, never an amount. */
export const PriceBand = z.enum([
  'INR_UNDER_5K',
  'INR_5K_10K',
  'INR_10K_25K',
  'INR_25K_50K',
  'INR_50K_PLUS',
]);
export type PriceBand = z.infer<typeof PriceBand>;

const BAND_FLOORS_PAISE: ReadonlyArray<readonly [number, PriceBand]> = [
  [5_000_000, 'INR_50K_PLUS'],
  [2_500_000, 'INR_25K_50K'],
  [1_000_000, 'INR_10K_25K'],
  [500_000, 'INR_5K_10K'],
];

export function priceBand(paise: number): PriceBand {
  return BAND_FLOORS_PAISE.find(([floor]) => paise >= floor)?.[1] ?? 'INR_UNDER_5K';
}

const PaymentStage = z.enum(['ADVANCE', 'BALANCE']);
const Shoot = { categoryCode: CategoryCode, tier: PlanTier, hours: Hours };

export const ANALYTICS_EVENTS = {
  // ── Client: the booking funnel, in order ──────────────────────────────────
  app_opened: z.strictObject({}),
  sign_in_started: z.strictObject({}),
  sign_in_completed: z.strictObject({ isNewAccount: z.boolean() }),
  serviceability_checked: z.strictObject({ result: z.enum(['LIVE', 'PILOT', 'WAITLIST']) }),
  waitlist_joined: z.strictObject({}),
  shoot_picked: z.strictObject({ categoryCode: CategoryCode, tier: PlanTier }),
  quote_viewed: z.strictObject({
    ...Shoot,
    emergencyBand: EmergencyBand,
    priceBand: PriceBand,
  }),
  details_completed: z.strictObject({
    addonCount: z.int().min(0).max(8),
    giftedToSubject: z.boolean(),
  }),
  booking_created: z.strictObject({ ...Shoot, emergencyBand: EmergencyBand }),
  payment_started: z.strictObject({ stage: PaymentStage, authorizeOnly: z.boolean() }),
  payment_succeeded: z.strictObject({ stage: PaymentStage }),
  payment_failed: z.strictObject({
    stage: PaymentStage,
    reason: z.enum(['DISMISSED', 'DECLINED', 'TIMEOUT', 'UNKNOWN']),
  }),
  booking_cancelled: z.strictObject({ fromStatus: BookingStatus }),
  delivery_opened: z.strictObject({}),
  review_submitted: z.strictObject({ rating: z.int().min(1).max(5), hasComment: z.boolean() }),
  ticket_raised: z.strictObject({ category: z.string().regex(/^[A-Z_]{2,32}$/) }),
  quality_issue_reported: z.strictObject({}),
  // ── Pro: the job loop ─────────────────────────────────────────────────────
  pro_offer_viewed: z.strictObject({ emergencyBand: EmergencyBand, isBroadcast: z.boolean() }),
  pro_offer_accepted: z.strictObject({ emergencyBand: EmergencyBand }),
  pro_offer_declined: z.strictObject({ emergencyBand: EmergencyBand }),
  pro_checked_in: z.strictObject({
    geofenceBasis: z.enum(['VENUE', 'PINCODE_CENTROID', 'CITY_CENTRE']),
    verified: z.boolean(),
    offline: z.boolean(),
  }),
  pro_checked_out: z.strictObject({ offline: z.boolean() }),
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsCatalogue = {
  readonly [N in AnalyticsEventName]: z.infer<(typeof ANALYTICS_EVENTS)[N]>;
};

/**
 * Screens are named by route PATTERN (expo-router's `[id]` segments), never by a concrete path:
 * a path can carry a booking id or a delivery token.
 */
export const CLIENT_ANALYTICS_SCREENS = [
  '/(tabs)',
  '/(tabs)/bookings',
  '/(tabs)/help',
  '/(tabs)/profile',
  '/sign-in',
  '/plan/[tier]',
  '/book/configure',
  '/book/review',
  '/book/pay/[id]',
  '/book/confirmed/[id]',
  '/bookings/[id]',
  '/support/new',
] as const;

export const PRO_ANALYTICS_SCREENS = [
  '/(tabs)',
  '/(tabs)/earnings',
  '/(tabs)/profile',
  '/sign-in',
  '/offers/[attemptId]',
  '/jobs/[assignmentId]',
] as const;

export const ANALYTICS_SCREENS = [...CLIENT_ANALYTICS_SCREENS, ...PRO_ANALYTICS_SCREENS] as const;
export type AnalyticsScreen = (typeof ANALYTICS_SCREENS)[number];

/** The validated properties, or null: an unknown event, an unknown key or a bad value. */
export function parseAnalyticsEvent(
  name: string,
  props: unknown,
): Readonly<Record<string, string | number | boolean>> | null {
  if (!Object.hasOwn(ANALYTICS_EVENTS, name)) return null;
  const schema = ANALYTICS_EVENTS[name as AnalyticsEventName];
  const parsed = schema.safeParse(props);
  return parsed.success ? (parsed.data as Record<string, string | number | boolean>) : null;
}
