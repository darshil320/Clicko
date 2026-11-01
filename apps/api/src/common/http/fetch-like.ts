/**
 * The slice of `fetch` the provider adapters use (WhatsApp, MSG91, Expo, Exotel). Injected so
 * tests answer from recorded fixtures and never reach the network.
 */
export interface FetchResponseLike {
  readonly status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    readonly method: 'GET' | 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export const HTTP_FETCH = Symbol('HTTP_FETCH');

/** Provider calls give up after this long (a BullMQ retry follows). */
export const PROVIDER_TIMEOUT_MS = 10_000;

export const globalFetch: FetchLike = (url, init) => fetch(url, init);

/** JSON body or null (an HTML error page from a proxy is not JSON). */
export async function readJson(res: FetchResponseLike): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 408, 425, 429 and 5xx may succeed later; other 4xx will not. */
export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/** A provider's id for a message or call: ids only (base64 and uuid shapes), never free text. */
const PROVIDER_ID = /^[A-Za-z0-9._:=+/-]{1,128}$/;

/** The provider's id if it looks like one; anything else is stored as null, never verbatim. */
export const providerId = (value: unknown): string | null =>
  typeof value === 'string' && PROVIDER_ID.test(value) ? value : null;
