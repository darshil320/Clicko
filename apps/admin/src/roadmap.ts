/** Build status shown on the console home page. Updated at the end of every sprint (with docs/PROGRESS.md). */
export type SprintState = 'done' | 'in-progress' | 'next' | 'planned' | 'blocked';

export interface Sprint {
  readonly id: string;
  readonly title: string;
  readonly dates: string;
  readonly state: SprintState;
  readonly shipped: readonly string[];
  readonly note?: string;
}

export const ROADMAP: readonly Sprint[] = [
  {
    id: 'S0',
    title: 'Foundations',
    dates: '21 – 30 Oct',
    state: 'done',
    shipped: [
      'Monorepo, design tokens, contracts, money utils (bigint paise)',
      'Postgres + PostGIS schema migrated from the spec (+ audit addenda)',
      'Legal pages site: Terms, Refund, Privacy, Grievance',
      'Claude Code guard rails: hooks, review agents, skills',
    ],
  },
  {
    id: 'S1',
    title: 'Auth + serviceability',
    dates: '2 – 6 Nov',
    state: 'done',
    shipped: [
      'Phone OTP login with rate limits and brute-force protection',
      'Rotating sessions with theft detection',
      'Pincode gate: Surat, Mumbai LIVE · Vadodara PILOT · waitlist elsewhere',
    ],
  },
  {
    id: 'S2',
    title: 'Pricing engine',
    dates: '9 – 13 Nov',
    state: 'done',
    shipped: [
      'Doc 05 rate card published as ruleset 2026.10.01',
      '12-step quote algorithm: tiers, categories, emergency bands, surge, night, weekend, travel, add-ons, promo, GST',
      'POST /pricing/quote + this console’s quote calculator',
      '231-case test matrix (doc 05 §10), written independently of the engine — zero disagreements',
    ],
  },
  {
    id: 'S3',
    title: 'Bookings + payments',
    dates: '16 – 20 Nov',
    state: 'done',
    shipped: [
      'Booking state machine with an outbox event on every transition',
      'Server-side re-pricing + immutable price snapshot at booking',
      'Sandbox + Razorpay gateways, signed webhooks, replay-safe',
      'GST advance invoices (FY series) + balanced double-entry ledger',
      'Idempotency keys on every money endpoint · booking simulator in this console',
    ],
  },
  {
    id: 'S4',
    title: 'Client app booking flow',
    dates: '23 – 27 Nov',
    state: 'in-progress',
    shipped: [
      'Expo app v0 (web + iOS/Android bundles): sign-in → pincode → live prices → configure → review → pay → confirmed',
      '16 RN primitives from design tokens · typed API SDK',
    ],
    note: 'Visual pass when Figma Wave 1 lands',
  },
  {
    id: 'S5',
    title: 'Dispatch engine',
    dates: '30 Nov – 4 Dec',
    state: 'done',
    shipped: [
      'Outbox publisher (BullMQ) with backoff + dead-letter alerts',
      'PostGIS eligibility + ranking; 4-wave cascade; emergency broadcast',
      'First-accept-wins (Redis lock) + EXCLUDE constraint: no double booking',
      'Unfilled bookings auto-cancel at T-90 min; holds released, captures flagged for refund',
      'Photographer OTP login, offers without address, accept/decline, re-dispatch + penalties',
      'Dispatch desk in this console',
    ],
  },
  {
    id: 'S6',
    title: 'Pro app',
    dates: '7 – 11 Dec',
    state: 'done',
    shipped: [
      'On-site API: en-route, geofenced check-in/out (150 m), offline queue with a trusted-time floor',
      'Extensions the client approves in the app (1-hour blocks, max 4), waiting time, client no-show',
      'No-show ladder: alert at +15 min, escalate at +20 (penalty + emergency re-broadcast)',
      'Access-denied / unsafe-site reports; earnings by day, week and month (IST)',
      'Clickco Pro app: offers with a live countdown, accept/decline, the job screen from on my way to check-out',
      'Works without signal: on-site taps are saved on the phone with their time and sent on reconnect',
      'Mock GPS locations are refused at check-in and check-out',
    ],
    note: 'Seen working in the browser; a real-phone run needs a dev build (expo run:android)',
  },
  {
    id: 'S7',
    title: 'Upload portal + media',
    dates: '14 – 18 Dec',
    state: 'done',
    shipped: [
      'StoragePort (local disk now, Google Drive adapter next) with resumable 8 MiB parts',
      'Every part and every file SHA-256-verified; file content checked against its extension',
      'Upload portal on :3002: folder drop, pause/resume across tab closes, progress and ETA',
      'RAW → JPEG export (darktable) → QA; weekly integrity audit; storage quota alerts',
      'Security review closed (ADR-0015): CSP, isolated darktable, storage reservation + reaper',
    ],
  },
  {
    id: 'S8',
    title: 'Delivery + SLA machine',
    dates: '21 – 25 Dec',
    state: 'done',
    shipped: [
      'QA gate, then the balance: paid in the app, GST invoice to the exact paisa',
      'Links issued by Clickco only after everything is paid; the storage link is never shown',
      'Every SLA clock from check-out, paused while the client pays; reminders; abandon at 30 days',
      'Late delivery recorded with a provisional remedy (amounts waiting on Darshil)',
      'RAW files deleted at 7 days, JPEGs and links at 30, then the booking closes',
    ],
    note: 'Proven by a 13-scenario end-to-end test; the staff QA desk comes with the admin panel',
  },
  { id: 'S9–10', title: 'Admin panel', dates: '28 Dec – 8 Jan', state: 'planned', shipped: [] },
  {
    id: 'S11',
    title: 'Notifications + polish',
    dates: '11 – 15 Jan',
    state: 'planned',
    shipped: [],
  },
  {
    id: 'S12',
    title: 'Launch prep',
    dates: '18 – 22 Jan',
    state: 'in-progress',
    shipped: ['Marketing site: home, cities, 24 SEO pages, sitemap, JSON-LD, waitlist form'],
  },
];

export const WAITING_ON_OWNER: readonly string[] = [
  'Registered address, privacy email and Grievance Officer — then the legal site can go live for Razorpay KYC',
  'Confirm photos-only at launch (no video)',
  'Confirm clickco.in ownership + Cloudflare',
  'Figma Wave 1 designs (gates the client app, S4)',
  'Razorpay test keys (S3 builds against a sandbox adapter until then)',
  'Late-delivery compensation amounts (a provisional table is in place, never applied automatically)',
];
