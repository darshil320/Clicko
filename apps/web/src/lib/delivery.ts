/**
 * The delivery page (`/d/<token>`, ADR-0027 D6c): what the client opens from the DELIVERED
 * WhatsApp/SMS message. The token comes from the path, goes only to the Clickco API, and the
 * response is checked against the API's own contract before anything is shown.
 */
import { DeliveryFolderView, type DeliveryLinkKind } from '@clickco/contracts/delivery';

/** A link token exactly as the API accepts it (DELIVERY_CONFIG.publicToken): base64url, 43. */
export const DELIVERY_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** `/d/<token>` or `/d/<token>/` (the export adds trailing slashes). */
const DELIVERY_PATH = /^\/d\/([^/]*)\/?$/;

/** The token in the page's path, or null when the path is not a well-formed delivery link. */
export function tokenFromPath(pathname: string): string | null {
  const segment = DELIVERY_PATH.exec(pathname)?.[1];
  return segment !== undefined && DELIVERY_TOKEN.test(segment) ? segment : null;
}

/** GET /d/<token> on the API: the file list. */
export const listingUrl = (apiBase: string, token: string): string => `${apiBase}/d/${token}`;

/** GET /d/<token>/files/<id> on the API: one file, streamed as an attachment. */
export const downloadUrl = (apiBase: string, token: string, fileId: string): string =>
  `${apiBase}/d/${token}/files/${encodeURIComponent(fileId)}`;

export type DeliveryProblem = 'expired' | 'not-found' | 'invalid' | 'error';

export type DeliveryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly folder: DeliveryFolderView }
  | { readonly kind: DeliveryProblem };

const errorCodeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body as { error: unknown };
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : null;
};

const dataOf = (body: unknown): unknown =>
  typeof body === 'object' && body !== null && 'data' in body
    ? (body as { data: unknown }).data
    : undefined;

/**
 * What the page shows for an API answer. Only a 200 whose body passes the contract is a file
 * list; the API's own codes say expired (410 LINK_EXPIRED) or unknown (404 LINK_NOT_FOUND); every
 * other answer (a throttle, an outage, a proxy page) is a retryable error.
 */
export function stateFromResponse(status: number, body: unknown): DeliveryState {
  if (status === 200) {
    const parsed = DeliveryFolderView.safeParse(dataOf(body));
    return parsed.success ? { kind: 'ready', folder: parsed.data } : { kind: 'error' };
  }
  const code = errorCodeOf(body);
  if (status === 410 || code === 'LINK_EXPIRED') return { kind: 'expired' };
  if (status === 404 && code === 'LINK_NOT_FOUND') return { kind: 'not-found' };
  return { kind: 'error' };
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Reads the file list. Never cached, never with cookies, never with a Referer (the page's own
 * URL carries the token), and never following a redirect: the API does not redirect.
 */
export async function fetchDelivery(
  apiBase: string,
  token: string,
  options: { readonly fetch?: Fetch; readonly signal?: AbortSignal } = {},
): Promise<DeliveryState> {
  const request = options.fetch ?? fetch;
  try {
    const response = await request(listingUrl(apiBase, token), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    return stateFromResponse(response.status, body);
  } catch {
    return { kind: 'error' };
  }
}

/** The state before any request: a malformed path or a build without an API never fetches. */
export function initialState(token: string | null, apiBase: string | null): DeliveryState {
  if (token === null) return { kind: 'invalid' };
  if (apiBase === null) return { kind: 'error' };
  return { kind: 'loading' };
}

/* ── Wording ──────────────────────────────────────────────────────────────────────────── */

export interface KindCopy {
  readonly title: string;
  /** Shown under the list; empty when there is nothing to add. */
  readonly note: string;
}

const SAVE_ON_WIFI = 'They are large: save them over Wi-Fi if you can.';

export const KIND_COPY: Readonly<Record<DeliveryLinkKind, KindCopy>> = {
  JPEG_PHOTO: { title: 'Your photos are ready.', note: '' },
  RAW_PHOTO: {
    title: 'Your RAW files are ready.',
    note: `RAW files open in a photo editor that reads your camera’s format. ${SAVE_ON_WIFI}`,
  },
  VIDEO: {
    title: 'Your video clips are ready.',
    note: `These are the unedited clips. ${SAVE_ON_WIFI}`,
  },
};

export interface ProblemCopy {
  readonly badge: string;
  readonly title: string;
  readonly detail: string;
  /** Worth trying again from the page (a network or server problem). */
  readonly retry: boolean;
}

const ASK_US = 'If you still need help, ask us from Help in the Clickco app.';

export const PROBLEM_COPY: Readonly<Record<DeliveryProblem, ProblemCopy>> = {
  expired: {
    badge: 'Link closed',
    title: 'This link has expired.',
    detail: `Delivery links close after a set time. Your booking in the Clickco app shows what is still available. ${ASK_US}`,
    retry: false,
  },
  'not-found': {
    badge: 'Link not found',
    title: 'We couldn’t find this link.',
    detail: `Open it again from your WhatsApp or SMS message, exactly as it was sent. ${ASK_US}`,
    retry: false,
  },
  invalid: {
    badge: 'Incomplete link',
    title: 'This link isn’t complete.',
    detail: `Part of the link seems to be missing. Open it again from your WhatsApp or SMS message without editing it. ${ASK_US}`,
    retry: false,
  },
  error: {
    badge: 'Not loaded',
    title: 'We couldn’t load your files.',
    detail: 'Check your connection and try again in a moment.',
    retry: true,
  },
};

/* ── Formatting ───────────────────────────────────────────────────────────────────────── */

const UNITS = ['KB', 'MB', 'GB', 'TB'] as const;
const KIB = 1024;

/** 900 → "900 bytes", 64_000 → "63 KB", 1_610_612_736 → "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < KIB) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  let value = bytes / KIB;
  let unit = 0;
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB;
    unit += 1;
  }
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${shown} ${UNITS[unit]}`;
}

export const fileCount = (n: number): string => (n === 1 ? '1 file' : `${n} files`);

const IST_OFFSET_MS = 330 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Sat 14 Nov 2026, 4:30 pm IST": India time whatever the phone's own zone. */
export function formatIstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const hours = d.getUTCHours();
  const minutes = `${d.getUTCMinutes()}`.padStart(2, '0');
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hour12}:${minutes} ${hours < 12 ? 'am' : 'pm'} IST`;
}

/** "6 days left", "5 hours left", "less than an hour left"; null once it has passed. */
export function timeLeft(iso: string, now: Date): string | null {
  const ms = new Date(iso).getTime() - now.getTime();
  if (!(ms > 0)) return null;
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return days === 1 ? '1 day left' : `${days} days left`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours >= 1) return hours === 1 ? '1 hour left' : `${hours} hours left`;
  return 'less than an hour left';
}
