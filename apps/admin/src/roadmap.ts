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
    shipped: [],
    note: 'v0 built from the doc 01 screen specs (web + phones); visual pass when Figma Wave 1 lands',
  },
  {
    id: 'S5',
    title: 'Dispatch engine',
    dates: '30 Nov – 4 Dec',
    state: 'in-progress',
    shipped: [],
  },
  { id: 'S6', title: 'Pro app', dates: '7 – 11 Dec', state: 'planned', shipped: [] },
  { id: 'S7', title: 'Upload portal + media', dates: '14 – 18 Dec', state: 'planned', shipped: [] },
  {
    id: 'S8',
    title: 'Delivery + SLA machine',
    dates: '21 – 25 Dec',
    state: 'planned',
    shipped: [],
  },
  { id: 'S9–10', title: 'Admin panel', dates: '28 Dec – 8 Jan', state: 'planned', shipped: [] },
  {
    id: 'S11',
    title: 'Notifications + polish',
    dates: '11 – 15 Jan',
    state: 'planned',
    shipped: [],
  },
  { id: 'S12', title: 'Launch prep', dates: '18 – 22 Jan', state: 'planned', shipped: [] },
];

export const WAITING_ON_OWNER: readonly string[] = [
  'Registered address, privacy email and Grievance Officer — then the legal site can go live for Razorpay KYC',
  'Confirm photos-only at launch (no video)',
  'Confirm clickco.in ownership + Cloudflare',
  'Figma Wave 1 designs (gates the client app, S4)',
  'Razorpay test keys (S3 builds against a sandbox adapter until then)',
];
