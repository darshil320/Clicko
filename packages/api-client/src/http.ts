import { TokenPair } from '@clickco/contracts';
import type { z } from 'zod';
import { unwrapEnvelope } from './envelope.js';
import { ApiError, invalidResponse, isApiError, networkError } from './errors.js';
import { isValidIdempotencyKey } from './idempotency.js';

/** The subset of the Fetch API the SDK needs — satisfied by browsers, React Native and Node 18+. */
export interface FetchResponseLike {
  readonly status: number;
  text(): Promise<string>;
  /** Binary answers (a KYC document): browsers, React Native and Node 18+ all have these. */
  arrayBuffer?(): Promise<ArrayBuffer>;
  readonly headers?: { get(name: string): string | null };
}
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Where the session lives. The app supplies it (MMKV on device); the SDK never persists anything. */
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(pair: TokenPair): void;
  clear(): void;
}

export interface HttpOptions {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly tokens?: TokenStore;
  /** Called once when the refresh token is rejected — the app routes to sign-in. */
  readonly onSessionExpired?: () => void;
  readonly timeoutMs?: number;
  /** Where a 401 refreshes the session. Default `/auth/refresh`; the Pro app uses `/pro/auth/refresh`. */
  readonly refreshPath?: string;
}

export interface RequestSpec<T> {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly schema: z.ZodType<T>;
  readonly body?: unknown;
  /** Sends the bearer token and refreshes it once on a 401. */
  readonly auth?: boolean;
  /** Required by every money-mutating route; reuse the same key for retries of one action. */
  readonly idempotencyKey?: string;
  /**
   * A binary answer: a 2xx body is read as bytes and `schema` validates `{ bytes, contentType }`.
   * Errors are still the JSON envelope.
   */
  readonly binary?: boolean;
}

/** What a binary request resolves to (before its schema). */
export interface BinaryBody {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_PATH = '/auth/refresh';
/** Refresh answers that mean the refresh token itself is no good. */
const SESSION_REJECTED: ReadonlySet<number> = new Set([400, 401, 403]);

export interface Http {
  request<T>(spec: RequestSpec<T>): Promise<T>;
}

export function createHttp(options: HttpOptions): Http {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl: FetchLike =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init) as Promise<FetchResponseLike>);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const refreshPath = options.refreshPath ?? DEFAULT_REFRESH_PATH;
  let refreshing: Promise<boolean> | null = null;

  async function send<T>(spec: RequestSpec<T>, accessToken: string | null): Promise<T> {
    const headers: Record<string, string> = { accept: spec.binary ? '*/*' : 'application/json' };
    if (spec.body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (spec.idempotencyKey !== undefined) headers['idempotency-key'] = spec.idempotencyKey;

    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response: FetchResponseLike;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl}${spec.path}`, {
        method: spec.method,
        headers,
        ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (spec.binary && response.status >= 200 && response.status < 300) {
        if (!response.arrayBuffer) throw new Error('this fetch cannot read binary answers');
        const body: BinaryBody = {
          bytes: new Uint8Array(await response.arrayBuffer()),
          contentType: response.headers?.get('content-type') ?? 'application/octet-stream',
        };
        return spec.schema.parse(body);
      }
      text = await response.text();
    } catch (error) {
      const aborted = controller?.signal.aborted === true;
      throw aborted
        ? networkError('The server took too long to answer', 'TIMEOUT')
        : networkError(
            error instanceof Error && error.message
              ? `Cannot reach Clickco: ${error.message}`
              : 'Cannot reach Clickco',
          );
    } finally {
      if (timer) clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      throw invalidResponse(
        response.status,
        `Unexpected response from the server (HTTP ${response.status})`,
      );
    }
    return unwrapEnvelope(response.status, json, spec.schema);
  }

  /** One refresh at a time: concurrent 401s wait on the same promise. */
  function refreshOnce(tokens: TokenStore): Promise<boolean> {
    if (refreshing) return refreshing;
    const refreshToken = tokens.getRefreshToken();
    if (!refreshToken) return Promise.resolve(false);
    refreshing = send(
      { method: 'POST', path: refreshPath, body: { refreshToken }, schema: TokenPair },
      null,
    )
      .then((pair) => {
        tokens.setTokens(pair);
        return true;
      })
      .catch((error: unknown) => {
        // Only an explicit rejection (400/401/403) ends the session. A rate limit (429 — many
        // Indian mobile users share one CGNAT IP), a 5xx or a flaky network must not sign anyone out.
        if (isApiError(error) && error.kind === 'HTTP' && SESSION_REJECTED.has(error.status)) {
          // The session was replaced meanwhile (a password change returns a new pair): the
          // refusal is about the old token, so carry on with the new one instead of signing out.
          return tokens.getRefreshToken() !== refreshToken && tokens.getAccessToken() !== null;
        }
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function expire(tokens: TokenStore): void {
    tokens.clear();
    options.onSessionExpired?.();
  }

  async function request<T>(spec: RequestSpec<T>): Promise<T> {
    if (spec.idempotencyKey !== undefined && !isValidIdempotencyKey(spec.idempotencyKey)) {
      throw new ApiError({
        kind: 'HTTP',
        status: 0,
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key must be 8–128 characters of A–Z, a–z, 0–9, . _ : -',
      });
    }
    const tokens = spec.auth ? options.tokens : undefined;
    if (!spec.auth || !tokens) return send(spec, null);

    try {
      return await send(spec, tokens.getAccessToken());
    } catch (error) {
      if (!isApiError(error) || error.kind !== 'HTTP' || error.status !== 401) throw error;
      const refreshed = await refreshOnce(tokens);
      if (!refreshed) {
        expire(tokens);
        throw error;
      }
    }
    // The original request was rejected by the auth guard, before any idempotency claim,
    // so resending it under the same key is safe.
    try {
      return await send(spec, tokens.getAccessToken());
    } catch (error) {
      if (isApiError(error) && error.kind === 'HTTP' && error.status === 401) expire(tokens);
      throw error;
    }
  }

  return { request };
}
