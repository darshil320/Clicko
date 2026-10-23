/**
 * Every failure the SDK surfaces is an ApiError, so callers branch on `kind` / `code`
 * instead of parsing messages.
 *
 * - HTTP: the API answered with an error envelope (status ≥ 400).
 * - NETWORK: no usable answer — offline, DNS, CORS, timeout. `status` is 0.
 * - INVALID_RESPONSE: the API answered, but not with the contract shape.
 */
export type ApiErrorKind = 'HTTP' | 'NETWORK' | 'INVALID_RESPONSE';

export interface ApiErrorInit {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  /** True for a 4xx answer: retrying the same request will not help. */
  get isClientError(): boolean {
    return this.kind === 'HTTP' && this.status >= 400 && this.status < 500;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export const networkError = (message: string, code = 'NETWORK'): ApiError =>
  new ApiError({ kind: 'NETWORK', status: 0, code, message });

export const invalidResponse = (status: number, message: string, details?: unknown): ApiError =>
  new ApiError({ kind: 'INVALID_RESPONSE', status, code: 'INVALID_RESPONSE', message, details });
