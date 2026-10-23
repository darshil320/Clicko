import { ApiError, unwrapEnvelope } from '@clickco/api-client';
import { TokenPair } from '@clickco/contracts';
import type { z } from 'zod';
import { loadSession, saveSession, updateTokens } from './session';

/** Public base URL of the API (not a secret). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface RequestSpec<T> {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly schema: z.ZodType<T>;
  readonly json?: unknown;
  /** Raw body (upload parts), sent as application/octet-stream. */
  readonly bytes?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  /** Sends the photographer's bearer token and refreshes it once on a 401. */
  readonly auth?: boolean;
  readonly signal?: AbortSignal;
}

interface RawResponse {
  readonly status: number;
  readonly json: unknown;
}

export const isAbort = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';

async function send<T>(spec: RequestSpec<T>, accessToken: string | null): Promise<RawResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...(spec.headers ?? {}) };
  if (spec.json !== undefined) headers['content-type'] = 'application/json';
  if (spec.bytes !== undefined) headers['content-type'] = 'application/octet-stream';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (spec.idempotencyKey) headers['idempotency-key'] = spec.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${spec.path}`, {
      method: spec.method,
      headers,
      ...(spec.json !== undefined ? { body: JSON.stringify(spec.json) } : {}),
      ...(spec.bytes !== undefined ? { body: spec.bytes as BodyInit } : {}),
      ...(spec.signal ? { signal: spec.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError({
      kind: 'NETWORK',
      status: 0,
      code: 'NETWORK',
      message: 'Cannot reach Clickco — check your connection',
    });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time; only an explicit rejection signs the photographer out. */
function refreshOnce(): Promise<boolean> {
  if (refreshing) return refreshing;
  const current = loadSession();
  if (!current) return Promise.resolve(false);
  refreshing = send(
    {
      method: 'POST',
      path: '/pro/auth/refresh',
      schema: TokenPair,
      json: { refreshToken: current.refreshToken },
    },
    null,
  )
    .then((res) => {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        saveSession(null);
        return false;
      }
      updateTokens(unwrapEnvelope(res.status, res.json, TokenPair));
      return true;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Calls the API and validates the answer against its contract schema; throws ApiError otherwise. */
export async function api<T>(spec: RequestSpec<T>): Promise<T> {
  const token = spec.auth ? (loadSession()?.accessToken ?? null) : null;
  if (spec.auth && !token) {
    throw new ApiError({
      kind: 'HTTP',
      status: 401,
      code: 'SIGNED_OUT',
      message: 'Please sign in again',
    });
  }
  let res = await send(spec, token);
  if (res.status === 401 && spec.auth) {
    if (!(await refreshOnce())) {
      throw new ApiError({
        kind: 'HTTP',
        status: 401,
        code: 'SIGNED_OUT',
        message: 'Your session ended — sign in again',
      });
    }
    res = await send(spec, loadSession()?.accessToken ?? null);
  }
  return unwrapEnvelope(res.status, res.json, spec.schema);
}

export const errorMessage = (error: unknown): string =>
  error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Something went wrong';
