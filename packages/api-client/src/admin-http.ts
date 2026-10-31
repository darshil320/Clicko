import { type AdminListQuery, AdminListQuery as ListQuerySchema, Uuid } from '@clickco/contracts';
import { z } from 'zod';
import type { Idempotent } from './client.js';
import { ApiError } from './errors.js';
import type { BinaryBody, Http } from './http.js';

/**
 * Shared building blocks for the `/admin/*` clients (ADR-0025, ADR-0026 D9). Each desk area has
 * its own file (`admin-<area>-client.ts`) that receives `AdminRequests`; `createAdminApiClient`
 * composes them.
 */

export function invalid(code: string, message: string): ApiError {
  return new ApiError({ kind: 'HTTP', status: 0, code, message });
}

/** Every admin id in a path is a UUID; anything else never reaches a path. */
export function idSegment(value: string): string {
  if (!Uuid.safeParse(value).success) throw invalid('INVALID_ID', 'That link is not valid');
  return value;
}

/** Validates a request body or query against its contract before it leaves the browser. */
export function checked<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ApiError({
    kind: 'HTTP',
    status: 0,
    code: 'INVALID_INPUT',
    message: issue?.message ?? 'Check the form and try again',
    details: parsed.error.issues,
  });
}

export function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? path : `${path}?${query}`;
}

/** `?cursor=&limit=` for the queue-style lists, validated against `AdminListQuery`. */
export function listParams(query: AdminListQuery): URLSearchParams {
  const q = checked(ListQuerySchema, query);
  const params = new URLSearchParams();
  if (q.cursor) params.set('cursor', q.cursor);
  params.set('limit', String(q.limit));
  return params;
}

export interface AdminRequests {
  /** Authenticated GET of `path` (+ query), validated against `schema`. */
  get<T>(path: string, schema: z.ZodType<T>, params?: URLSearchParams): Promise<T>;
  /** Authenticated POST with an Idempotency-Key (one key per intent, reused on retry). */
  post<T>(path: string, schema: z.ZodType<T>, idem: Idempotent, body?: unknown): Promise<T>;
  /** Authenticated GET of a binary answer (bytes + content type). */
  getBytes(path: string): Promise<BinaryBody>;
}

const BinaryBodySchema = z.object({
  bytes: z.instanceof(Uint8Array),
  contentType: z.string(),
});

export function adminRequests(http: Http): AdminRequests {
  return {
    get: (path, schema, params) =>
      http.request({
        method: 'GET',
        path: params ? withQuery(path, params) : path,
        schema,
        auth: true,
      }),
    post: (path, schema, { idempotencyKey }, body) =>
      http.request({
        method: 'POST',
        path,
        schema,
        auth: true,
        idempotencyKey,
        ...(body === undefined ? {} : { body }),
      }),
    getBytes: (path) =>
      http.request({ method: 'GET', path, schema: BinaryBodySchema, auth: true, binary: true }),
  };
}
