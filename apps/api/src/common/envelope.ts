/** The one response shape every endpoint returns (success / data / error). */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface Envelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: ApiError | null;
}

export const ok = <T>(data: T): Envelope<T> => ({ success: true, data, error: null });
