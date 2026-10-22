/** Thin client for the Clickco API envelope. Base URL from NEXT_PUBLIC_API_URL (public, not a secret). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: ApiErrorBody };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = (await res.json()) as {
      success: boolean;
      data: T;
      error: ApiErrorBody | string | null;
    };
    if (body.success) return { ok: true, status: res.status, data: body.data };
    const error =
      typeof body.error === 'string' || body.error === null
        ? { code: 'ERROR', message: body.error ?? 'Request failed' }
        : body.error;
    return { ok: false, status: res.status, error };
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'UNREACHABLE', message: `Cannot reach the API at ${API_URL}` },
    };
  }
}
