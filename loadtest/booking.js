// (b) Quote → booking → pay (sandbox) → confirmed. Each VU is one seeded client
// (`node loadtest/seed/seed.mjs clients` … `tokens`). The payment is captured through the dev
// payment simulator, which feeds a signed webhook through the real verify → dedupe → apply path,
// so the target must run the sandbox gateway with DEV_TOOLS=on (the load-test stack, README).
// Shoots are booked 10–20 days ahead (50/50 advance). Every 5th funnel is abandoned instead: the
// client cancels before paying (a paid booking cannot be cancelled through the API yet, ADR-0029).
// Paid bookings stay CONFIRMED/DISPATCHING on the throwaway stack; dispatch load is part of the test.
//
//   k6 run -e BASE_URL=https://perf-api.example loadtest/booking.js
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import {
  assertSafeTarget,
  BASE_URL,
  data,
  headers,
  idemKey,
  jsonHeaders,
  MAX_TEST_DURATION,
  seedFile,
} from './lib/common.js';

const clients = seedFile('clients.json');
const PINCODES = (__ENV.PINCODES || '395007,395009,400050,390007').split(',');
const SHOOTS = [
  ['FOOD', 'PROFESSIONAL'],
  ['PRODUCT', 'BASIC'],
  ['CORPORATE', 'PROFESSIONAL'],
  ['WEDDING', 'EXPERT'],
];

const confirmSeconds = new Trend('booking_confirm_seconds');

export const options = {
  scenarios: {
    funnel: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: Math.min(clients.length, 50),
      maxVUs: clients.length,
      stages: [
        { target: Number(__ENV.PEAK_RPS || 2), duration: '2m' },
        { target: Number(__ENV.PEAK_RPS || 2), duration: __ENV.HOLD || '6m' },
        { target: 0, duration: '1m' },
      ],
    },
  },
  maxDuration: MAX_TEST_DURATION,
  // ADR-0029 D5 (b).
  thresholds: {
    'http_req_failed{scenario:funnel}': ['rate<0.005'],
    'http_req_duration{name:quote}': ['p(95)<300', 'p(99)<800'],
    'http_req_duration{name:create-booking}': ['p(95)<600'],
    'http_req_duration{name:pay}': ['p(95)<800'],
    'http_req_duration{name:webhook}': ['p(95)<800'],
    'http_req_duration{name:cancel}': ['p(95)<800'],
    booking_confirm_seconds: ['p(95)<5'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  assertSafeTarget(http);
}

/** 10–20 days ahead, on a half hour between 10:00 and 16:30 IST. */
function startAt() {
  const day = 10 + Math.floor(Math.random() * 10);
  const halfHours = Math.floor(Math.random() * 14);
  const d = new Date(Date.now() + day * 86_400_000);
  d.setUTCHours(4, 30 + halfHours * 30, 0, 0);
  return d.toISOString();
}

export default function () {
  const me = clients[exec.vu.idInTest % clients.length];
  const [categoryCode, tier] = SHOOTS[exec.scenario.iterationInTest % SHOOTS.length];
  const shoot = {
    tier,
    categoryCode,
    pincode: PINCODES[exec.scenario.iterationInTest % PINCODES.length],
    scheduledStart: startAt(),
    hours: 2,
  };
  const quote = data(
    http.post(`${BASE_URL}/pricing/quote`, JSON.stringify(shoot), {
      headers: jsonHeaders(null),
      tags: { name: 'quote' },
    }),
    'quote',
  );
  if (quote === null) return;
  sleep(1 + Math.random() * 2); // the person reads the quote

  const created = data(
    http.post(
      `${BASE_URL}/bookings`,
      JSON.stringify({
        ...shoot,
        venueAddress: 'Load test venue, do not dispatch',
        booker: { name: 'Load Test', phone: me.phone },
        modelReleaseConsent: false,
        acceptedTermsVersion: 'v2-draft',
      }),
      {
        headers: jsonHeaders(me.accessToken, { 'idempotency-key': idemKey('book') }),
        tags: { name: 'create-booking' },
      },
    ),
    'create-booking',
  );
  if (created === null) return;
  const bookingId = created.booking.id;

  if (exec.scenario.iterationInTest % 5 === 4) {
    // The person changes their mind at the payment screen.
    data(
      http.post(`${BASE_URL}/bookings/${bookingId}/cancel`, null, {
        headers: headers(me.accessToken, { 'idempotency-key': idemKey('cancel') }),
        tags: { name: 'cancel' },
      }),
      'cancel',
    );
    return;
  }

  const order = data(
    http.post(`${BASE_URL}/bookings/${bookingId}/pay`, null, {
      headers: headers(me.accessToken, { 'idempotency-key': idemKey('pay') }),
      tags: { name: 'pay' },
    }),
    'pay',
  );
  if (order === null) return;
  const paidAt = Date.now();
  const sim = data(
    http.post(
      `${BASE_URL}/dev/payments/${order.paymentId}/simulate`,
      JSON.stringify({ outcome: 'CAPTURED' }),
      { headers: jsonHeaders(null), tags: { name: 'webhook' } },
    ),
    'webhook',
  );
  check(sim, { 'webhook applied': (s) => s !== null && s.outcome === 'APPLIED' });

  // The outbox ticks every 2 s: CONFIRMED is the webhook itself, DISPATCHING follows.
  let status = null;
  for (let i = 0; i < 20; i += 1) {
    const view = data(
      http.get(`${BASE_URL}/bookings/${bookingId}`, {
        headers: headers(me.accessToken),
        tags: { name: 'booking' },
      }),
      'booking',
    );
    status = view === null ? null : view.booking.status;
    if (status === 'CONFIRMED' || status === 'DISPATCHING') break;
    sleep(0.5);
  }
  if (check(status, { confirmed: (s) => s === 'CONFIRMED' || s === 'DISPATCHING' })) {
    confirmSeconds.add((Date.now() - paidAt) / 1000);
  }
}
