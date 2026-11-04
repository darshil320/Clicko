/**
 * Steps 1–11: from the target check to the shoot in progress. The client and the photographer
 * act through the real SDKs; only the OTP read, the payment simulator and the dispatch view are
 * dev endpoints.
 */
import {
  DEV_PHOTOGRAPHERS,
  devPhone,
} from '../../apps/api/src/infra/db/seeds/dev-photographers.js';
import { type RunContext, type Step, waitFor } from './context.js';
import { DispatchDeskView, newIdempotencyKey, rawCall } from './sdk.js';
import { signInClient, signInPro } from './sessions.js';

/** Hosts the dry run must never touch. The dev endpoints are absent there anyway. */
const PRODUCTION_HOSTS: readonly string[] = ['api.clickco.in', 'clickco.in'];

const bookingStatus = async (ctx: RunContext) =>
  (await ctx.client.bookings.get(ctx.need('bookingId'))).booking.status;

const target: Step = {
  id: 'target',
  name: 'target is a dev API',
  async run(ctx) {
    const host = new URL(ctx.options.api).hostname;
    if (PRODUCTION_HOSTS.includes(host)) throw new Error(`${host} is production: refused`);
    const response = await fetch(`${ctx.options.api}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 200) throw new Error(`/health answered HTTP ${response.status}`);
    return `${ctx.options.api} healthy`;
  },
};

const clientSignIn: Step = {
  id: 'client-sign-in',
  name: 'client signs in (OTP)',
  async run(ctx) {
    try {
      const user = await signInClient(ctx.client, ctx.clientTokens, ctx.state.clientPhone);
      return `${ctx.state.clientPhone} → user ${user.id.slice(0, 8)} (new: ${user.isNew})`;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        throw new Error('GET /dev/otp is missing: the target must run with DEV_TOOLS=on');
      }
      throw error;
    }
  },
};

const quoteBody = (ctx: RunContext) => ({
  tier: ctx.options.tier,
  categoryCode: ctx.options.category,
  pincode: ctx.options.pincode,
  scheduledStart: new Date(Date.now() + ctx.options.leadMinutes * 60_000).toISOString(),
  hours: ctx.options.hours,
});

const quote: Step = {
  id: 'quote',
  name: 'quote',
  async run(ctx) {
    const q = await ctx.client.pricing.quote(quoteBody(ctx));
    if (q.kind !== 'QUOTE')
      throw new Error(`${ctx.options.tier} is quote-only (enquiry), not bookable`);
    return `${ctx.options.tier} ${ctx.options.category} ${ctx.options.hours} h, total ${q.totalPaise} paise, band ${q.emergencyBand}`;
  },
};

const book: Step = {
  id: 'book',
  name: 'create booking',
  async run(ctx) {
    const { booking } = await ctx.client.bookings.create(
      {
        ...quoteBody(ctx),
        venueAddress: 'Dry run, 4 Athwalines, Surat',
        booker: { name: 'Dry Run Client', phone: ctx.state.clientPhone },
        modelReleaseConsent: false,
        acceptedTermsVersion: 'v2-draft',
        specialRequirements: 'Staff dry run (scripts/dry-run). Not a real shoot.',
      },
      { idempotencyKey: newIdempotencyKey() },
    );
    ctx.update({
      bookingId: booking.id,
      bookingReference: booking.reference,
      scheduledStart: booking.scheduledStart,
    });
    return `${booking.reference} ${booking.status}, starts ${booking.scheduledStart}, advance ${booking.advancePaise} paise`;
  },
};

const payAdvance: Step = {
  id: 'pay-advance',
  name: 'pay advance (sandbox)',
  async run(ctx) {
    const bookingId = ctx.need('bookingId');
    const order = await ctx.client.bookings.pay(bookingId, { idempotencyKey: newIdempotencyKey() });
    const sim = await ctx.client.dev.simulatePayment(order.paymentId, 'CAPTURED');
    if (sim.outcome !== 'APPLIED') throw new Error(`the simulated webhook was ${sim.outcome}`);
    const status = await waitFor(
      'CONFIRMED or later',
      () => bookingStatus(ctx),
      (s) => s !== 'QUOTED' && s !== 'ADVANCE_PENDING',
      { timeoutMs: 30_000 },
    );
    const mode = order.authorizeOnly ? 'authorised (captured on acceptance)' : 'captured';
    return `${order.amountPaise} paise ${mode}, ${sim.event}; booking ${status}`;
  },
};

/** The dev seed's photographers by name → phone (apps/api seeds/dev-photographers.ts). */
const DEV_PHONES: ReadonlyMap<string, string> = new Map(
  DEV_PHOTOGRAPHERS.map((p, i) => [p.name, devPhone(i)] as const),
);

const dispatch: Step = {
  id: 'dispatch',
  name: 'dispatch offers a pro',
  async run(ctx) {
    const bookingId = ctx.need('bookingId');
    const view = await waitFor(
      'a pending offer to a dev-seed photographer',
      () =>
        rawCall(ctx.options.api, {
          method: 'GET',
          path: `/dev/dispatch/bookings/${bookingId}`,
          schema: DispatchDeskView,
        }),
      (v) =>
        v.rounds.some((r) =>
          r.attempts.some((a) => a.outcome === 'PENDING' && DEV_PHONES.has(a.photographerName)),
        ),
      { timeoutMs: 90_000, intervalMs: 2_000 },
    );
    const round = view.rounds.find((r) => r.attempts.some((a) => a.outcome === 'PENDING'));
    const attempt = round?.attempts.find(
      (a) => a.outcome === 'PENDING' && DEV_PHONES.has(a.photographerName),
    );
    if (!round || !attempt) throw new Error('no pending offer');
    ctx.update({
      photographerId: attempt.photographerId,
      photographerName: attempt.photographerName,
      photographerPhone: DEV_PHONES.get(attempt.photographerName),
    });
    return `wave ${round.wave}: ${round.attempts.length} offered; using ${attempt.photographerName} (${attempt.distanceKm ?? '?'} km)`;
  },
};

const proSignIn: Step = {
  id: 'pro-sign-in',
  name: 'photographer signs in',
  async run(ctx) {
    const pro = await signInPro(ctx.pro, ctx.proTokens, ctx.need('photographerPhone'));
    if (pro.id !== ctx.state.photographerId)
      throw new Error('signed in as a different photographer');
    return `${pro.displayName} (${ctx.state.photographerPhone})`;
  },
};

const accept: Step = {
  id: 'accept',
  name: 'photographer accepts',
  async run(ctx) {
    const bookingId = ctx.need('bookingId');
    const offers = await ctx.pro.offers.list();
    const offer = offers.find((o) => o.bookingId === bookingId);
    if (!offer) throw new Error(`no offer for ${ctx.state.bookingReference} in the Pro feed`);
    const accepted = await ctx.pro.offers.accept(offer.attemptId, {
      idempotencyKey: newIdempotencyKey(),
    });
    ctx.update({ assignmentId: accepted.assignmentId });
    const status = await waitFor(
      'ASSIGNED',
      () => bookingStatus(ctx),
      (s) => s === 'ASSIGNED',
      {
        timeoutMs: 30_000,
      },
    );
    return `assignment ${accepted.assignmentId.slice(0, 8)}, payout ${offer.payoutPaise} paise; booking ${status}`;
  },
};

const enRoute: Step = {
  id: 'en-route',
  name: 'en route',
  async run(ctx) {
    const r = await ctx.pro.onsite.enRoute(ctx.need('assignmentId'), {
      idempotencyKey: newIdempotencyKey(),
    });
    return `booking ${r.bookingStatus}`;
  },
};

export const fix = (ctx: RunContext) => ({
  lat: ctx.options.lat,
  lng: ctx.options.lng,
  accuracyM: 12,
});

const checkIn: Step = {
  id: 'check-in',
  name: 'check-in (geofence)',
  async run(ctx) {
    const r = await ctx.pro.onsite.checkIn(ctx.need('assignmentId'), fix(ctx), {
      idempotencyKey: newIdempotencyKey(),
    });
    const fence = `${Math.round(r.distanceM)} m vs ${r.geofenceBasis}, verified ${r.geofenceVerified}`;
    return `booking ${r.bookingStatus}; ${fence}; billing from ${r.billingStartsAt}`;
  },
};

const start: Step = {
  id: 'start',
  name: 'shoot starts',
  async run(ctx) {
    const r = await ctx.pro.onsite.start(ctx.need('assignmentId'), {
      idempotencyKey: newIdempotencyKey(),
    });
    return `booking ${r.bookingStatus}`;
  },
};

export const BOOKING_STEPS: readonly Step[] = [
  target,
  clientSignIn,
  quote,
  book,
  payAdvance,
  dispatch,
  proSignIn,
  accept,
  enRoute,
  checkIn,
  start,
];
