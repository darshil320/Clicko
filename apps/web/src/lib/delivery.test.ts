import { describe, expect, it } from 'vitest';
import {
  downloadUrl,
  fetchDelivery,
  fileCount,
  formatBytes,
  formatIstDateTime,
  initialState,
  KIND_COPY,
  listingUrl,
  PROBLEM_COPY,
  stateFromResponse,
  timeLeft,
  tokenFromPath,
} from './delivery';

const TOKEN = 'Ab0_-'.repeat(8).concat('xyz'); // 43 base64url characters
const API = 'https://api.clickco.in';
const FILE_ID = '7d1f0b9e-4a51-4c51-9d0e-2b5f5f0b1a11';

const folder = {
  bookingReference: 'CLK-1004',
  kind: 'JPEG_PHOTO',
  expiresAt: '2026-12-01T11:00:00.000Z',
  fileCount: 1,
  totalBytes: 2_048,
  files: [
    {
      id: FILE_ID,
      name: 'IMG_0001.JPG',
      sizeBytes: 2_048,
      contentType: 'image/jpeg',
      path: `/d/${TOKEN}/files/${FILE_ID}`,
    },
  ],
};
const ok = (data: unknown) => ({ success: true, data, error: null });
const failed = (code: string) => ({ success: false, data: null, error: { code, message: 'x' } });

describe('tokenFromPath (the token is read from the path, checked like the API does)', () => {
  it('reads /d/<token>, with or without the trailing slash', () => {
    expect(TOKEN).toHaveLength(43);
    expect(tokenFromPath(`/d/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromPath(`/d/${TOKEN}/`)).toBe(TOKEN);
  });

  it('refuses anything that is not exactly one well-formed token', () => {
    for (const path of [
      '/d/',
      '/d',
      `/d/${TOKEN.slice(1)}`,
      `/d/${TOKEN}A`,
      `/d/${TOKEN.slice(1)}=`,
      `/d/${TOKEN.slice(1)}%`,
      `/d/${TOKEN.slice(2)}%2F`,
      `/d/${TOKEN}/files/${FILE_ID}`,
      `/x/d/${TOKEN}`,
      `/D/${TOKEN}`,
      `/d/${TOKEN.slice(1)}.`,
    ]) {
      expect(tokenFromPath(path), path).toBeNull();
    }
  });
});

describe('API URLs', () => {
  it('lists from and downloads through the API, under the same token', () => {
    expect(listingUrl(API, TOKEN)).toBe(`${API}/d/${TOKEN}`);
    expect(downloadUrl(API, TOKEN, FILE_ID)).toBe(`${API}/d/${TOKEN}/files/${FILE_ID}`);
    expect(downloadUrl(API, TOKEN, '../me')).toBe(`${API}/d/${TOKEN}/files/..%2Fme`);
  });
});

describe('initialState', () => {
  it('never fetches for a malformed link or a build without an API', () => {
    expect(initialState(null, API)).toEqual({ kind: 'invalid' });
    expect(initialState(TOKEN, null)).toEqual({ kind: 'error' });
    expect(initialState(TOKEN, API)).toEqual({ kind: 'loading' });
  });
});

describe('stateFromResponse (state selection)', () => {
  it('shows a file list only when the body passes the contract', () => {
    expect(stateFromResponse(200, ok(folder))).toEqual({ kind: 'ready', folder });
    for (const body of [
      ok({ ...folder, bookingReference: undefined }),
      ok({ ...folder, files: [{ ...folder.files[0], id: 'not-a-uuid' }] }),
      ok({ ...folder, kind: 'PDF' }),
      ok(null),
      null,
      '<html>',
    ]) {
      expect(stateFromResponse(200, body)).toEqual({ kind: 'error' });
    }
  });

  it('expired: 410, or the API saying LINK_EXPIRED', () => {
    expect(stateFromResponse(410, failed('LINK_EXPIRED'))).toEqual({ kind: 'expired' });
    expect(stateFromResponse(410, null)).toEqual({ kind: 'expired' });
  });

  it('not found: only the API’s own LINK_NOT_FOUND, not any 404 page', () => {
    expect(stateFromResponse(404, failed('LINK_NOT_FOUND'))).toEqual({ kind: 'not-found' });
    expect(stateFromResponse(404, null)).toEqual({ kind: 'error' });
  });

  it('anything else is a retryable error', () => {
    for (const status of [0, 400, 429, 500, 502, 503]) {
      expect(stateFromResponse(status, failed('RATE_LIMITED'))).toEqual({ kind: 'error' });
    }
  });
});

describe('fetchDelivery', () => {
  it('asks the API without cache, cookies, Referer or redirects', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const state = await fetchDelivery(API, TOKEN, {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(ok(folder)), { status: 200 });
      },
    });
    expect(state).toEqual({ kind: 'ready', folder });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${API}/d/${TOKEN}`);
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
  });

  it('a network failure, an abort or a non-JSON body is an error state, never a throw', async () => {
    const reject = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await fetchDelivery(API, TOKEN, { fetch: reject })).toEqual({ kind: 'error' });
    const html = async () => new Response('<html>busy</html>', { status: 503 });
    expect(await fetchDelivery(API, TOKEN, { fetch: html })).toEqual({ kind: 'error' });
    const gone = async () => new Response(JSON.stringify(failed('LINK_EXPIRED')), { status: 410 });
    expect(await fetchDelivery(API, TOKEN, { fetch: gone })).toEqual({ kind: 'expired' });
  });
});

describe('wording', () => {
  it('has a title for every kind and a message for every problem', () => {
    expect(Object.keys(KIND_COPY).sort()).toEqual(['JPEG_PHOTO', 'RAW_PHOTO', 'VIDEO']);
    expect(Object.keys(PROBLEM_COPY).sort()).toEqual(['error', 'expired', 'invalid', 'not-found']);
    expect(PROBLEM_COPY.error.retry).toBe(true);
    expect(PROBLEM_COPY.expired.retry).toBe(false);
  });
});

describe('formatting', () => {
  it('sizes in binary units, one decimal under ten', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(900)).toBe('900 bytes');
    expect(formatBytes(64_000)).toBe('63 KB');
    expect(formatBytes(5 * 1024 ** 2 + 300 * 1024)).toBe('5.3 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3 TB');
    expect(fileCount(1)).toBe('1 file');
    expect(fileCount(12)).toBe('12 files');
  });

  it('shows the expiry in India time', () => {
    expect(formatIstDateTime('2026-11-14T11:00:00.000Z')).toBe('Sat 14 Nov 2026, 4:30 pm IST');
    expect(formatIstDateTime('2026-12-31T18:35:00.000Z')).toBe('Fri 1 Jan 2027, 12:05 am IST');
    expect(formatIstDateTime('2026-11-15T06:30:00.000Z')).toBe('Sun 15 Nov 2026, 12:00 pm IST');
  });

  it('counts down in days, then hours', () => {
    const now = new Date('2026-11-14T00:00:00.000Z');
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
    expect(timeLeft(at(6 * 86_400_000 + 5), now)).toBe('6 days left');
    expect(timeLeft(at(86_400_000), now)).toBe('1 day left');
    expect(timeLeft(at(5 * 3_600_000), now)).toBe('5 hours left');
    expect(timeLeft(at(3_600_000), now)).toBe('1 hour left');
    expect(timeLeft(at(60_000), now)).toBe('less than an hour left');
    expect(timeLeft(at(0), now)).toBeNull();
    expect(timeLeft('not a date', now)).toBeNull();
  });
});
