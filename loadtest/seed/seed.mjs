#!/usr/bin/env node
// Seeds load-test data through the API's own routes plus the dev endpoints (OTP peek, payment
// simulator). Those exist only with NODE_ENV=development, DEV_TOOLS=on and a database on the
// same machine — i.e. the disposable load-test stack (ADR-0029 D5), never staging or
// production. Plain Node 22, no packages, no pnpm. See loadtest/README.md.
//
//   node loadtest/seed/seed.mjs <command> [--api URL] [--count N]
//   clients   N client accounts                       → .seed/clients.json
//   shoots    one live shoot per dev-seed photographer → .seed/shoots.json   (IN_PROGRESS)
//   checkout  check out every shoot whose booked hours are over (≈4 h after `shoots`)
//   deliver   take N checked-out shoots to DELIVERED  → .seed/deliveries.json
//   tokens    fresh 15-minute access tokens            → .seed/uploaders.json, clients.json
//   status    what is seeded
import { parseArgs } from 'node:util';
import {
  ApiFailure,
  assertHealthy,
  createApi,
  env,
  pool,
  readSeed,
  refresh,
  sha256,
  signIn,
  signInStaff,
  sleep,
  syntheticFile,
  writeSeed,
} from './api.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: { type: 'string', default: env('BASE_URL') ?? 'http://localhost:4000' },
    count: { type: 'string' },
    'lead-minutes': { type: 'string', default: '125' },
    photographers: { type: 'string', default: '22' },
  },
});
const api = createApi(values.api);
const log = (text) => process.stdout.write(`${text}\n`);

/** City centres (apps/api seeds/launch-cities.ts): the check-in point for un-geocoded venues. */
const CITY_CENTRES = {
  Surat: { lat: 21.1702, lng: 72.8311 },
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Vadodara: { lat: 22.3072, lng: 73.1812 },
};
const CITY_PINCODES = ['395007', '400050', '390007'];
const CATEGORIES = ['FOOD', 'PRODUCT', 'CORPORATE', 'WEDDING', 'REAL_ESTATE'];
const FIX = (city) => ({ ...CITY_CENTRES[city], accuracyM: 12 });

// ── clients ─────────────────────────────────────────────────────────────────────────────────

async function clients() {
  const count = Number(values.count ?? 40);
  const phones = Array.from({ length: count }, (_, i) => `+91999902${String(i).padStart(4, '0')}`);
  const results = await pool(phones, 4, async (phone) => ({
    phone,
    ...(await signIn(api, 'client', phone)).tokens,
  }));
  const ok = results.filter((r) => r.ok).map((r) => r.value);
  writeSeed('clients.json', ok);
  log(`clients: ${ok.length}/${count} signed in`);
  for (const r of results.filter((x) => !x.ok)) log(`  failed: ${r.error.message}`);
}

// ── shoots ──────────────────────────────────────────────────────────────────────────────────

async function cityIds() {
  const map = {};
  for (const pincode of CITY_PINCODES) {
    const s = await api.call('GET', `/serviceability/${pincode}`);
    if (s.bookable) map[s.city.id] = { pincode, name: s.city.name };
  }
  return map;
}

async function signInPhotographers() {
  const n = Number(values.photographers);
  const phones = Array.from(
    { length: n },
    (_, i) => `+919999000${String(101 + i).padStart(3, '0')}`,
  );
  const results = await pool(phones, 4, async (phone) => {
    const { tokens, account } = await signIn(api, 'pro', phone);
    return { phone, cityId: account.cityId, tokens };
  });
  return results.filter((r) => r.ok).map((r) => r.value);
}

async function bookAndPay(client, pincode, categoryCode, startIso) {
  const created = await api.call('POST', '/bookings', {
    token: client.accessToken,
    idem: true,
    json: {
      tier: 'BASIC',
      categoryCode,
      pincode,
      scheduledStart: startIso,
      hours: 2,
      venueAddress: 'Load test venue, seeded',
      booker: { name: 'Load Test', phone: client.phone },
      modelReleaseConsent: false,
      acceptedTermsVersion: 'v2-draft',
    },
  });
  const order = await api.call('POST', `/bookings/${created.booking.id}/pay`, {
    token: client.accessToken,
    idem: true,
  });
  await api.call('POST', `/dev/payments/${order.paymentId}/simulate`, {
    json: { outcome: 'CAPTURED' },
  });
  return { bookingId: created.booking.id, reference: created.booking.reference, client };
}

async function acceptOffers(pros, bookingIds) {
  const assigned = new Map(); // bookingId → { pro, assignmentId }
  const busy = new Set();
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline && assigned.size < bookingIds.size) {
    for (const pro of pros.filter((p) => !busy.has(p.phone))) {
      const offers = await api.call('GET', '/pro/offers', { token: pro.tokens.accessToken });
      const offer = offers.find((o) => bookingIds.has(o.bookingId) && !assigned.has(o.bookingId));
      if (!offer) continue;
      try {
        const r = await api.call('POST', `/pro/offers/${offer.attemptId}/accept`, {
          token: pro.tokens.accessToken,
          idem: true,
        });
        assigned.set(offer.bookingId, { pro, assignmentId: r.assignmentId });
        busy.add(pro.phone);
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status >= 500) throw error;
      }
    }
    await sleep(3_000);
  }
  return assigned;
}

async function shoots() {
  await assertHealthy(api);
  const clientsSeed = readSeed('clients.json', []);
  if (clientsSeed.length === 0) throw new Error('run `seed.mjs clients` first');
  const cities = await cityIds();
  const pros = await signInPhotographers();
  log(`photographers signed in: ${pros.length}`);
  const start = new Date(Date.now() + Number(values['lead-minutes']) * 60_000).toISOString();
  const plans = pros
    .filter((p) => cities[p.cityId])
    .map((p, i) => ({
      pincode: cities[p.cityId].pincode,
      category: CATEGORIES[i % CATEGORIES.length],
    }));
  const booked = await pool(plans, 4, (plan, i) =>
    bookAndPay(clientsSeed[i % clientsSeed.length], plan.pincode, plan.category, start),
  );
  const bookings = booked.filter((b) => b.ok).map((b) => b.value);
  for (const b of booked.filter((x) => !x.ok)) log(`  booking failed: ${b.error.message}`);
  log(`bookings paid: ${bookings.length}; waiting for dispatch…`);
  await sleep(5_000);
  const assigned = await acceptOffers(pros, new Set(bookings.map((b) => b.bookingId)));
  const seeded = [];
  for (const b of bookings) {
    const a = assigned.get(b.bookingId);
    // A paid booking cannot be cancelled through the API (ADR-0029): an unaccepted one stays in
    // dispatch until its deadline (start − 90 min) cancels it and flags the refund.
    if (!a) continue;
    const t = a.pro.tokens.accessToken;
    const detail = await api.call('GET', `/pro/assignments/${a.assignmentId}`, { token: t });
    const fix = FIX(detail.venue.cityName);
    await api.call('POST', `/pro/assignments/${a.assignmentId}/en-route`, { token: t, idem: true });
    await api.call('POST', `/pro/assignments/${a.assignmentId}/check-in`, {
      token: t,
      idem: true,
      json: fix,
    });
    await api.call('POST', `/pro/assignments/${a.assignmentId}/start`, { token: t, idem: true });
    const after = await api.call('GET', `/pro/assignments/${a.assignmentId}`, { token: t });
    seeded.push({
      bookingId: b.bookingId,
      reference: b.reference,
      city: detail.venue.cityName,
      assignmentId: a.assignmentId,
      earliestCheckOutAt: after.earliestCheckOutAt,
      state: 'IN_PROGRESS',
      pro: { phone: a.pro.phone, ...a.pro.tokens },
      client: b.client,
    });
  }
  writeSeed('shoots.json', seeded);
  log(
    `shoots in progress: ${seeded.length} (left unassigned in dispatch: ${bookings.length - seeded.length})`,
  );
  if (seeded[0])
    log(`check-out opens at ${seeded[0].earliestCheckOutAt}: then run \`seed.mjs checkout\``);
}

// ── checkout ────────────────────────────────────────────────────────────────────────────────

async function withFreshPro(shoot) {
  return { ...shoot, pro: { ...shoot.pro, ...(await refresh(api, 'pro', shoot.pro)) } };
}

async function checkout() {
  const all = readSeed('shoots.json', []);
  const updated = [];
  for (const s of all) {
    if (s.state !== 'IN_PROGRESS') {
      updated.push(s);
      continue;
    }
    if (Date.parse(s.earliestCheckOutAt) > Date.now()) {
      log(`  ${s.reference}: wait until ${s.earliestCheckOutAt}`);
      updated.push(s);
      continue;
    }
    const fresh = await withFreshPro(s);
    await api.call('POST', `/pro/assignments/${s.assignmentId}/check-out`, {
      token: fresh.pro.accessToken,
      idem: true,
      json: { ...FIX(s.city), declaredFrameCount: 5 },
    });
    updated.push({ ...fresh, state: 'CHECKED_OUT' });
  }
  writeSeed('shoots.json', updated);
  log(`checked out: ${updated.filter((s) => s.state === 'CHECKED_OUT').length}/${updated.length}`);
}

// ── deliver ─────────────────────────────────────────────────────────────────────────────────

async function uploadOneFrame(token, bookingId) {
  const files = ['LT_D_0001.DNG', 'LT_D_0001.JPG'].map((name, i) => ({
    clientFileId: `f${i}`,
    name,
    bytes: syntheticFile(name, 256 * 1024),
  }));
  const session = await api.call('POST', `/pro/bookings/${bookingId}/upload-sessions`, {
    token,
    idem: true,
    json: {
      declaredFrameCount: 1,
      files: files.map((f) => ({
        clientFileId: f.clientFileId,
        name: f.name,
        sizeBytes: f.bytes.length,
        kind: f.name.endsWith('.DNG') ? 'RAW_PHOTO' : 'JPEG_PHOTO',
        lastModified: Date.now(),
      })),
    },
  });
  for (const f of files) {
    const sid = session.sessionId;
    await api.call('PUT', `/pro/upload-sessions/${sid}/files/${f.clientFileId}/parts/1`, {
      token,
      bytes: f.bytes,
      headers: { 'x-part-sha256': sha256(f.bytes) },
    });
    await api.call('POST', `/pro/upload-sessions/${sid}/files/${f.clientFileId}/complete`, {
      token,
      idem: true,
      json: { sha256: sha256(f.bytes) },
    });
  }
  await api.call('POST', `/pro/upload-sessions/${session.sessionId}/complete`, {
    token,
    idem: true,
  });
}

async function waitStatus(token, bookingId, wanted, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { booking } = await api.call('GET', `/bookings/${bookingId}`, { token });
    if (wanted.includes(booking.status)) return booking.status;
    if (Date.now() > deadline) throw new Error(`${bookingId} stuck in ${booking.status}`);
    await sleep(2_000);
  }
}

async function deliverOne(shoot, staffToken) {
  const fresh = await withFreshPro(shoot);
  const client = { ...shoot.client, ...(await refresh(api, 'client', shoot.client)) };
  await uploadOneFrame(fresh.pro.accessToken, shoot.bookingId);
  await waitStatus(client.accessToken, shoot.bookingId, ['QA']);
  await api.call('POST', `/admin/qa/${shoot.bookingId}`, {
    token: staffToken,
    idem: true,
    json: { result: 'PASS', note: 'Load-test seed' },
  });
  const status = await waitStatus(client.accessToken, shoot.bookingId, [
    'BALANCE_PENDING',
    'DELIVERED',
  ]);
  if (status === 'BALANCE_PENDING') {
    const order = await api.call('POST', `/bookings/${shoot.bookingId}/pay`, {
      token: client.accessToken,
      idem: true,
    });
    await api.call('POST', `/dev/payments/${order.paymentId}/simulate`, {
      json: { outcome: 'CAPTURED' },
    });
    await waitStatus(client.accessToken, shoot.bookingId, ['DELIVERED'], 30_000);
  }
  const view = await api.call('GET', `/bookings/${shoot.bookingId}/delivery`, {
    token: client.accessToken,
  });
  const paths = view.links.filter((l) => !l.revoked).map((l) => l.path);
  return { shoot: { ...fresh, client, state: 'DELIVERED' }, paths };
}

async function deliver() {
  const all = readSeed('shoots.json', []);
  const count = Number(values.count ?? 3);
  const chosen = new Set(
    all
      .filter((s) => s.state === 'CHECKED_OUT')
      .slice(0, count)
      .map((s) => s.bookingId),
  );
  const staffToken = await signInStaff(api);
  const links = readSeed('deliveries.json', []);
  const updated = [];
  for (const s of all) {
    if (!chosen.has(s.bookingId)) {
      updated.push(s);
      continue;
    }
    const r = await deliverOne(s, staffToken);
    updated.push(r.shoot);
    links.push(...r.paths.map((path) => ({ path, reference: s.reference })));
    log(`  ${s.reference}: delivered, ${r.paths.length} links`);
  }
  writeSeed('shoots.json', updated);
  writeSeed('deliveries.json', links);
  log(`delivery links seeded: ${links.length}`);
}

// ── tokens / status ─────────────────────────────────────────────────────────────────────────

async function tokens() {
  const all = readSeed('shoots.json', []);
  const fresh = [];
  for (const s of all) fresh.push(s.state === 'CHECKED_OUT' ? await withFreshPro(s) : s);
  writeSeed('shoots.json', fresh);
  writeSeed(
    'uploaders.json',
    fresh
      .filter((s) => s.state === 'CHECKED_OUT')
      .map((s) => ({ bookingId: s.bookingId, accessToken: s.pro.accessToken })),
  );
  const clientsSeed = readSeed('clients.json', []);
  const refreshed = await pool(clientsSeed, 4, async (c) => ({
    ...c,
    ...(await refresh(api, 'client', c)),
  }));
  writeSeed(
    'clients.json',
    refreshed.filter((r) => r.ok).map((r) => r.value),
  );
  const until = new Date(Date.now() + 15 * 60_000).toISOString();
  log(
    `tokens refreshed (valid until about ${until}): ${fresh.filter((s) => s.state === 'CHECKED_OUT').length} uploaders, ${refreshed.filter((r) => r.ok).length} clients`,
  );
}

function status() {
  const all = readSeed('shoots.json', []);
  const by = Object.groupBy(all, (s) => s.state);
  const counts = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
  log(
    `clients ${readSeed('clients.json', []).length} · shoots ${JSON.stringify(counts)} · delivery links ${readSeed('deliveries.json', []).length}`,
  );
}

const COMMANDS = { clients, shoots, checkout, deliver, tokens, status };
const command = COMMANDS[positionals[0]];
if (!command) {
  log(
    `usage: node loadtest/seed/seed.mjs <${Object.keys(COMMANDS).join('|')}> [--api URL] [--count N]`,
  );
  process.exitCode = 2;
} else {
  Promise.resolve(command()).catch((error) => {
    process.stderr.write(`seed ${positionals[0]} failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
