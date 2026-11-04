// (a) Photographer upload: the portal's chunked, resumable upload (apps/portal/src/features/upload,
// ADR-0014 D2) against /pro/upload-sessions. Each VU is one photographer with one CHECKED_OUT
// booking (seed: `node loadtest/seed/seed.mjs shoots` … `checkout` … `tokens`). Per iteration:
// open a session, PUT every 8 MiB part (4 in flight, each with its SHA-256), complete each file
// with the whole-file SHA-256, then ABORT the session so the booking stays uploadable for the
// next iteration (set COMPLETE=1 to complete the last iteration instead: it starts JPEG export).
//
//   k6 run -e BASE_URL=https://perf-api.example -e VUS=20 loadtest/upload.js
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
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

const uploaders = seedFile('uploaders.json');
const VUS = Math.min(Number(__ENV.VUS || uploaders.length), uploaders.length);
const FILES = Number(__ENV.FILES_PER_SESSION || 5);
const PARTS_PER_FILE = Number(__ENV.PARTS_PER_FILE || 3);
const IN_FLIGHT = 4; // MEDIA_LIMITS.concurrentParts
const PART_BYTES = 8 * 1024 * 1024; // MEDIA_LIMITS.partSizeBytes (the server dictates it)

/** One 8 MiB part per VU, reused for every part: a TIFF header so a .DNG passes the signature check. */
const part = new Uint8Array(PART_BYTES);
for (let i = 0; i < PART_BYTES; i += 1) part[i] = (i * 2654435761) >>> 24;
part.set([0x49, 0x49, 0x2a, 0x00], 0);
const partBuffer = part.buffer;
const partSha = crypto.sha256(partBuffer, 'hex');
const fileSha = (() => {
  const h = crypto.createHash('sha256');
  for (let p = 0; p < PARTS_PER_FILE; p += 1) h.update(partBuffer);
  return h.digest('hex');
})();

const uploadedBytes = new Counter('upload_bytes');
const sessionSeconds = new Trend('upload_session_seconds');

export const options = {
  scenarios: {
    upload: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '10m',
      gracefulStop: '2m',
    },
  },
  maxDuration: MAX_TEST_DURATION,
  // ADR-0029 D5 (a). http_req_waiting = server time after the body was sent (client bandwidth
  // is not the API's problem; the server's hash + storage write is).
  thresholds: {
    'http_req_failed{scenario:upload}': ['rate<0.01'],
    'http_req_waiting{name:part}': ['p(95)<1500', 'p(99)<4000'],
    'http_req_duration{name:create-session}': ['p(95)<1500'],
    'http_req_duration{name:complete-file}': ['p(95)<1000'],
    'http_req_duration{name:abort-session}': ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  assertSafeTarget(http);
  return { startedAt: Date.now() };
}

function manifest(iteration) {
  const files = [];
  for (let f = 0; f < FILES; f += 1) {
    const stem = `LT_${exec.vu.idInTest}_${iteration}_${String(f).padStart(4, '0')}`;
    files.push({
      clientFileId: stem,
      name: `${stem}.DNG`,
      sizeBytes: PART_BYTES * PARTS_PER_FILE,
      kind: 'RAW_PHOTO',
      lastModified: Date.now(),
    });
  }
  return files;
}

function putParts(token, sessionId, files) {
  const requests = [];
  for (const file of files) {
    for (let n = 1; n <= PARTS_PER_FILE; n += 1) {
      requests.push([
        'PUT',
        `${BASE_URL}/pro/upload-sessions/${sessionId}/files/${file.clientFileId}/parts/${n}`,
        partBuffer,
        {
          headers: headers(token, {
            'content-type': 'application/octet-stream',
            'x-part-sha256': partSha,
          }),
          tags: { name: 'part' },
          timeout: '120s',
        },
      ]);
    }
  }
  for (let i = 0; i < requests.length; i += IN_FLIGHT) {
    const batch = http.batch(requests.slice(i, i + IN_FLIGHT));
    for (const res of batch) {
      if (data(res, 'part') !== null) uploadedBytes.add(PART_BYTES);
    }
  }
}

export default function () {
  const me = uploaders[(exec.vu.idInTest - 1) % uploaders.length];
  const began = Date.now();
  const files = manifest(exec.vu.iterationInScenario);
  const session = data(
    http.post(
      `${BASE_URL}/pro/bookings/${me.bookingId}/upload-sessions`,
      JSON.stringify({ files, declaredFrameCount: files.length }),
      {
        headers: jsonHeaders(me.accessToken, { 'idempotency-key': idemKey('session') }),
        tags: { name: 'create-session' },
      },
    ),
    'create-session',
  );
  if (session === null) return;
  putParts(me.accessToken, session.sessionId, files);
  for (const file of files) {
    data(
      http.post(
        `${BASE_URL}/pro/upload-sessions/${session.sessionId}/files/${file.clientFileId}/complete`,
        JSON.stringify({ sha256: fileSha }),
        {
          headers: jsonHeaders(me.accessToken, { 'idempotency-key': idemKey('file') }),
          tags: { name: 'complete-file' },
        },
      ),
      'complete-file',
    );
  }
  const finish = __ENV.COMPLETE === '1' && exec.scenario.progress > 0.95 ? 'complete' : 'abort';
  data(
    http.post(`${BASE_URL}/pro/upload-sessions/${session.sessionId}/${finish}`, null, {
      headers: headers(me.accessToken, { 'idempotency-key': idemKey(finish) }),
      tags: { name: `${finish}-session` },
    }),
    `${finish}-session`,
  );
  sessionSeconds.add((Date.now() - began) / 1000);
}
