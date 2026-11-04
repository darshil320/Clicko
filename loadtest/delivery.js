// (c) Public delivery: what a client's phone does from the WhatsApp link (the website's /d/<token>
// page reads GET /d/<token>, then each download is GET /d/<token>/files/<id>, streamed by the API
// from StoragePort). Links come from delivered seed bookings (`seed.mjs deliver`). No sign-in.
//
//   k6 run -e BASE_URL=https://perf-api.example loadtest/delivery.js
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import {
  assertSafeTarget,
  BASE_URL,
  data,
  headers,
  MAX_TEST_DURATION,
  seedFile,
} from './lib/common.js';

const links = seedFile('deliveries.json');

export const options = {
  scenarios: {
    listing: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.LISTING_RPS || 30),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    download: {
      executor: 'constant-vus',
      vus: Number(__ENV.DOWNLOAD_VUS || 10),
      duration: __ENV.DURATION || '5m',
      exec: 'download',
    },
  },
  maxDuration: MAX_TEST_DURATION,
  // ADR-0029 D5 (c). 429s would mean the per-IP link limit (60/min) is hit: see README.
  thresholds: {
    'http_req_failed{scenario:listing}': ['rate<0.005'],
    'http_req_duration{name:listing}': ['p(95)<300', 'p(99)<1000'],
    'http_req_failed{scenario:download}': ['rate<0.01'],
    'http_req_waiting{name:file}': ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  assertSafeTarget(http);
  if (links.length === 0) throw new Error('deliveries.json is empty: run `seed.mjs deliver` first');
}

const pick = () => links[exec.scenario.iterationInTest % links.length];

export default function () {
  const folder = data(
    http.get(`${BASE_URL}${pick().path}`, { headers: headers(null), tags: { name: 'listing' } }),
    'listing',
  );
  check(folder, { 'listing has files': (f) => f !== null && f.fileCount > 0 });
}

export function download() {
  const folder = data(
    http.get(`${BASE_URL}${pick().path}`, { headers: headers(null), tags: { name: 'listing' } }),
    'listing',
  );
  if (folder === null || folder.files.length === 0) return;
  const file = folder.files[exec.scenario.iterationInTest % folder.files.length];
  const res = http.get(`${BASE_URL}${file.path}`, {
    headers: headers(null, { accept: '*/*' }),
    responseType: 'none',
    tags: { name: 'file' },
    timeout: '120s',
  });
  check(res, {
    'file: 200': (r) => r.status === 200,
    'file: attachment': (r) => (r.headers['Content-Disposition'] || '').startsWith('attachment'),
  });
  sleep(1);
}
